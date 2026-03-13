#!/usr/bin/env node

// Main orchestrator entrypoint — connects Telegram channel, routes messages
// through the per-group queue, starts IPC polling, and handles graceful shutdown.
// Usage: npx tsx src/index.ts (reads TELEGRAM_BOT_TOKEN from .env)

import "dotenv/config";
import fs from "node:fs";
import { TelegramChannel } from "./channels/telegram.js";
import { getSecrets } from "./auth.js";
import { insertMessage, getOrphanedMessages, updateMessageStatus } from "./db.js";
import { enqueue, shutdown as shutdownQueue } from "./group-queue.js";
import { registerSender, startPolling, stopPolling } from "./ipc.js";
import { startScheduler, stopScheduler } from "./task-scheduler.js";
import { chatIdToGroup, groupToChatId } from "./group-mapping.js";
import { SHUTDOWN_TIMEOUT_MS, MCP_SERVERS_PATH } from "./config.js";
import type { McpServerConfig } from "./types.js";

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

  const { secrets, isApiKeyFallback } = await getSecrets();
  const mcpServers = loadMcpServers();
  // Use cheaper model when paying per-token via API key
  const model = isApiKeyFallback ? "claude-sonnet-4-6" : undefined;
  const channel = new TelegramChannel(botToken);

  // Register the channel's sendMessage for IPC to use
  registerSender((chatId, text) => channel.sendMessage(chatId, text));

  const knownGroups = new Set<string>();

  channel.onMessage((msg) => {
    const group = chatIdToGroup("tg", msg.chatId);

    // Log first message from a new group
    if (!knownGroups.has(group)) {
      knownGroups.add(group);
      console.log(`[Orchestrator] New group: ${group} (chat ${msg.chatId})`);
    }

    // Store user message immediately (before queuing) — starts as "pending"
    const messageId = insertMessage(group, "user", `[${msg.senderName}] ${msg.text}`, {
      chatId: msg.chatId,
      senderName: msg.senderName,
    });

    console.log(`[Orchestrator] ${msg.senderName} (group: ${group}): "${msg.text.slice(0, 80)}${msg.text.length > 80 ? "..." : ""}"`);

    // Send typing indicator while message waits in queue / runs
    channel.sendTyping(msg.chatId).catch(() => {});

    enqueue({
      group,
      chatId: msg.chatId,
      senderName: msg.senderName,
      text: msg.text,
      secrets,
      channel,
      mcpServers,
      model,
      attempt: 1,
      messageId,
    });
  });

  // Crash recovery: re-enqueue messages that were in-flight when we last stopped
  const orphans = getOrphanedMessages();
  if (orphans.length > 0) {
    console.log(`[Recovery] Found ${orphans.length} orphaned message(s) — re-enqueueing`);
    for (const msg of orphans) {
      const chatId = msg.chat_id ?? groupToChatId(msg.group_folder);
      if (!chatId) {
        console.warn(`[Recovery] Skipping message ${msg.id}: cannot resolve chatId for group ${msg.group_folder}`);
        updateMessageStatus(msg.id, "failed");
        continue;
      }
      console.log(`[Recovery] Re-enqueueing message ${msg.id} (group: ${msg.group_folder}): "${msg.content.slice(0, 60)}..."`);
      updateMessageStatus(msg.id, "pending");
      enqueue({
        group: msg.group_folder,
        chatId,
        senderName: msg.sender_name ?? "Unknown",
        text: msg.content,
        secrets,
        channel,
        mcpServers,
        model,
        attempt: 1,
        messageId: msg.id,
      });
    }
  }

  await channel.connect();
  startPolling();
  startScheduler({ secrets, channel, mcpServers, model });
  console.log("[Orchestrator] KuchiClaw is running. Press Ctrl+C to stop.");

  // Graceful shutdown: stop accepting → stop IPC → wait for running containers → exit
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; // Prevent double-shutdown from rapid signals
    shuttingDown = true;
    console.log("\n[Orchestrator] Shutting down...");

    // Stop receiving new messages, IPC polling, and scheduler
    await channel.disconnect();
    stopPolling();
    stopScheduler();

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
