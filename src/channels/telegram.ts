// Telegram channel adapter using node-telegram-bot-api (long polling).
// Implements the Channel interface from registry.ts.

import TelegramBot from "node-telegram-bot-api";
import { ALLOWED_SENDER_IDS } from "../config.js";
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
  private botUsername = "";

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

    // Learn our own username for @mention detection in group chats
    const me = await this.bot.getMe();
    this.botUsername = me.username ?? "";

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

      const senderId = msg.from?.id ? String(msg.from.id) : undefined;
      const chatType = msg.chat.type as IncomingMessage["chatType"];

      // Allowlist check — silently ignore senders not on the list
      if (ALLOWED_SENDER_IDS.length > 0 && senderId && !ALLOWED_SENDER_IDS.includes(senderId)) {
        return;
      }

      // Group chats require @mention to activate
      let text = msg.text;
      const isGroupChat = chatType === "group" || chatType === "supergroup";
      if (isGroupChat && this.botUsername) {
        const mentionTag = `@${this.botUsername}`;
        if (!text.includes(mentionTag)) return;
        text = text.replace(mentionTag, "").trim();
        if (!text) return; // Nothing left after stripping mention
      }

      const senderName =
        msg.from?.first_name ??
        msg.from?.username ??
        "Unknown";

      this.onMessageHandler({
        chatId: String(msg.chat.id),
        senderName,
        text,
        chatType,
        senderId,
      });
    });

    this.connected = true;
    console.log(`[Telegram] Connected (long polling) as @${this.botUsername}`);
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not connected");

    // Chunk long messages to stay within Telegram's limit
    // Use 4000 (not 4096) to leave headroom for HTML tag overhead
    const chunks = splitMessage(text, TELEGRAM_MAX_LENGTH - 96);
    for (const chunk of chunks) {
      const numericId = Number(chatId);
      try {
        // Convert standard Markdown to Telegram HTML
        await this.bot.sendMessage(numericId, markdownToHtml(chunk), {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch {
        // Fall back to plain text if HTML parsing fails
        await this.bot.sendMessage(numericId, chunk);
      }
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

/**
 * Convert standard Markdown to Telegram-compatible HTML.
 * Handles: code blocks, inline code, bold, italic, links, headers.
 * Strips unsupported syntax (horizontal rules, images).
 */
function markdownToHtml(text: string): string {
  // Step 1: Extract code blocks and inline code to protect them from further processing
  const codeBlocks: string[] = [];
  const placeholder = (i: number) => `\x00CODE${i}\x00`;

  // Fenced code blocks (```...```)
  let result = text.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_match, code: string) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return placeholder(i);
  });

  // Inline code (`...`)
  result = result.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder(i);
  });

  // Step 2: Escape HTML special chars in remaining text (not inside code)
  result = escapeHtml(result);

  // Step 3: Convert markdown formatting to HTML

  // Headers (# ... ) → just the text (OpenClaw flattens these)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ (but not inside words like some_var_name)
  result = result.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Blockquotes: > text
  result = result.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Horizontal rules (---, ***) → just remove
  result = result.replace(/^[-*_]{3,}\s*$/gm, "");

  // Step 4: Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(placeholder(i), codeBlocks[i]);
  }

  return result.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
