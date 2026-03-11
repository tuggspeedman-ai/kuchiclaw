#!/usr/bin/env node

// Main orchestrator entrypoint — connects Telegram channel, routes messages
// through the per-group queue, starts IPC polling, and handles graceful shutdown.
// Usage: TELEGRAM_BOT_TOKEN=xxx npx tsx src/index.ts

import fs from "node:fs";
import { TelegramChannel } from "./channels/telegram.js";
import { getSecrets } from "./auth.js";
import { insertMessage } from "./db.js";
import { enqueue, shutdown as shutdownQueue } from "./group-queue.js";
import { registerSender, startPolling, stopPolling } from "./ipc.js";
import { SHUTDOWN_TIMEOUT_MS, MCP_SERVERS_PATH } from "./config.js";
import type { McpServerConfig } from "./types.js";

const GROUP = "main"; // All chats → main group until M8

/** Load MCP server configs from mcp-servers.json (if it exists) */
function loadMcpServers(): Record<string, McpServerConfig> | undefined {
  if (!fs.existsSync(MCP_SERVERS_PATH)) return undefined;
  try {
    const raw = fs.readFileSync(MCP_SERVERS_PATH, "utf-8");
    const servers = JSON.parse(raw) as Record<string, McpServerConfig>;
    const count = Object.keys(servers).length;
    if (count > 0) {
      console.log(`[Orchestrator] Loaded ${count} MCP server(s) from mcp-servers.json`);
      return servers;
    }
  } catch (err) {
    console.warn(`[Orchestrator] Failed to load mcp-servers.json: ${err}`);
  }
  return undefined;
}

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required.");
    process.exit(1);
  }

  const secrets = getSecrets();
  const mcpServers = loadMcpServers();
  const channel = new TelegramChannel(botToken);

  // Register the channel's sendMessage for IPC to use
  registerSender((chatId, text) => channel.sendMessage(chatId, text));

  channel.onMessage((msg) => {
    // Store user message immediately (before queuing)
    insertMessage(GROUP, "user", `[${msg.senderName}] ${msg.text}`);

    console.log(`[Orchestrator] ${msg.senderName} (chat ${msg.chatId}): "${msg.text.slice(0, 80)}${msg.text.length > 80 ? "..." : ""}"`);

    // Send typing indicator while message waits in queue / runs
    channel.sendTyping(msg.chatId).catch(() => {});

    enqueue({
      group: GROUP,
      chatId: msg.chatId,
      senderName: msg.senderName,
      text: msg.text,
      secrets,
      channel,
      mcpServers,
      attempt: 1,
    });
  });

  await channel.connect();
  startPolling();
  console.log("[Orchestrator] KuchiClaw is running. Press Ctrl+C to stop.");

  // Graceful shutdown: stop accepting → stop IPC → wait for running containers → exit
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; // Prevent double-shutdown from rapid signals
    shuttingDown = true;
    console.log("\n[Orchestrator] Shutting down...");

    // Stop receiving new messages and IPC polling
    await channel.disconnect();
    stopPolling();

    // Wait for running containers to finish, with a hard timeout
    const finished = shutdownQueue();
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn(`[Orchestrator] Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) — forcing exit`);
        resolve();
      }, SHUTDOWN_TIMEOUT_MS),
    );

    await Promise.race([finished, timeout]);
    console.log("[Orchestrator] Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
