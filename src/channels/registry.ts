// Channel interface — abstraction over messaging platforms.
// Telegram first, extensible to WhatsApp etc. later.

/** Normalized incoming message from any channel */
export interface IncomingMessage {
  /** Channel-specific chat identifier (e.g., Telegram chat ID) */
  chatId: string;
  /** Display name of the sender */
  senderName: string;
  /** Message text content */
  text: string;
}

/** A messaging channel (Telegram, WhatsApp, etc.) */
export interface Channel {
  /** Establish connection to the messaging platform */
  connect(): Promise<void>;

  /** Send a text message to a specific chat */
  sendMessage(chatId: string, text: string): Promise<void>;

  /** Whether the channel is currently connected */
  isConnected(): boolean;

  /** Whether this channel owns/handles the given chat ID */
  ownsJid(jid: string): boolean;

  /** Gracefully disconnect from the messaging platform */
  disconnect(): Promise<void>;
}
