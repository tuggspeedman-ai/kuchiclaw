// Telegram channel adapter using node-telegram-bot-api (long polling).
// Implements the Channel interface from registry.ts.

import TelegramBot from "node-telegram-bot-api";
import type { Channel, IncomingMessage } from "./registry.js";

/** Max message length Telegram allows per message */
const TELEGRAM_MAX_LENGTH = 4096;

export type MessageHandler = (msg: IncomingMessage) => void;

export class TelegramChannel implements Channel {
  private bot: TelegramBot | null = null;
  private token: string;
  private connected = false;
  private onMessageHandler: MessageHandler | null = null;
  private startTime = Date.now();

  constructor(token: string) {
    this.token = token;
  }

  /** Register a callback for incoming user messages (not commands) */
  onMessage(handler: MessageHandler): void {
    this.onMessageHandler = handler;
  }

  async connect(): Promise<void> {
    this.bot = new TelegramBot(this.token, { polling: true });
    this.startTime = Date.now();

    // Bot commands
    this.bot.onText(/\/start/, (msg) => {
      this.bot!.sendMessage(msg.chat.id, "KuchiClaw is online. Send me a message.");
    });

    this.bot.onText(/\/status/, (msg) => {
      const uptimeMs = Date.now() - this.startTime;
      const uptimeMin = Math.floor(uptimeMs / 60_000);
      const statusText = `Status: running\nUptime: ${uptimeMin}m`;
      this.bot!.sendMessage(msg.chat.id, statusText);
    });

    // Regular messages (not commands)
    this.bot.on("message", (msg) => {
      if (!msg.text || msg.text.startsWith("/")) return;
      if (!this.onMessageHandler) return;

      const senderName =
        msg.from?.first_name ??
        msg.from?.username ??
        "Unknown";

      this.onMessageHandler({
        chatId: String(msg.chat.id),
        senderName,
        text: msg.text,
      });
    });

    this.connected = true;
    console.log("[Telegram] Connected (long polling)");
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not connected");

    // Chunk long messages to stay within Telegram's limit
    const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.bot.sendMessage(Number(chatId), chunk);
    }
  }

  /** Send typing indicator to a chat */
  async sendTyping(chatId: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.sendChatAction(Number(chatId), "typing");
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    // All Telegram chat IDs are numeric (possibly negative for groups)
    return /^-?\d+$/.test(jid);
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.connected = false;
      console.log("[Telegram] Disconnected");
    }
  }
}

/** Split text into chunks that fit within maxLen, breaking at newlines when possible */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to break at last newline within limit
    let breakIdx = remaining.lastIndexOf("\n", maxLen);
    if (breakIdx <= 0) breakIdx = maxLen; // No good break point — hard cut

    chunks.push(remaining.slice(0, breakIdx));
    remaining = remaining.slice(breakIdx).replace(/^\n/, ""); // trim leading newline
  }

  return chunks;
}
