#!/usr/bin/env node

// Bot entrypoint — long-running process that routes Telegram messages
// through the container-based agent loop.
// Usage: TELEGRAM_BOT_TOKEN=xxx npx tsx src/bot.ts

import { TelegramChannel } from "./channels/telegram.js";
import { getSecrets } from "./auth.js";
import { runContainer } from "./container-runner.js";
import { ensureGroupFolder } from "./group-folder.js";
import { insertMessage, getRecentMessages, formatHistory } from "./db.js";
import type { ContainerInput } from "./types.js";

const GROUP = "main"; // All chats → main group until M8

async function handleMessage(
  channel: TelegramChannel,
  chatId: string,
  senderName: string,
  text: string,
  secrets: Record<string, string>,
): Promise<void> {
  const paths = ensureGroupFolder(GROUP);

  // Load history before storing this message (so it's not included twice)
  const recentMessages = getRecentMessages(GROUP);
  const messageHistory = formatHistory(recentMessages);

  // Store the user's message
  insertMessage(GROUP, "user", `[${senderName}] ${text}`);

  const input: ContainerInput = {
    prompt: text,
    groupFolder: GROUP,
    secrets,
    messageHistory: messageHistory || undefined,
  };

  console.log(`[Bot] ${senderName} (chat ${chatId}): "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

  // Show typing indicator while container processes
  await channel.sendTyping(chatId);

  try {
    const output = await runContainer(input, paths);

    if (output.status === "success") {
      const result = output.result ?? "(no response)";
      insertMessage(GROUP, "assistant", result);
      await channel.sendMessage(chatId, result);
    } else {
      const errMsg = `Error: ${output.error ?? "unknown error"}`;
      console.error(`[Bot] Agent error: ${errMsg}`);
      await channel.sendMessage(chatId, errMsg);
    }
  } catch (err) {
    const errMsg = `Container error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Bot] ${errMsg}`);
    await channel.sendMessage(chatId, `Something went wrong. ${errMsg}`);
  }
}

async function main(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required.");
    process.exit(1);
  }

  const secrets = getSecrets();
  const channel = new TelegramChannel(botToken);

  channel.onMessage((msg) => {
    // Fire-and-forget — no queue yet (M5 adds proper queuing)
    handleMessage(channel, msg.chatId, msg.senderName, msg.text, secrets)
      .catch((err) => console.error("[Bot] Unhandled error:", err));
  });

  await channel.connect();
  console.log("[Bot] KuchiClaw bot is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[Bot] Shutting down...");
    await channel.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
