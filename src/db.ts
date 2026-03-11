// SQLite database for persistent message history.
// Uses better-sqlite3 (synchronous API) — fine for a single-process orchestrator.

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "./config.js";

const DB_PATH = path.join(DATA_DIR, "kuchiclaw.db");

/** A stored message (user prompt or agent response) */
export interface Message {
  id: number;
  group_folder: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
}

let db: Database.Database | null = null;

/** Get or create the database connection, initializing schema if needed. */
export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);

  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_group_time
      ON messages (group_folder, timestamp DESC);
  `);

  return db;
}

/** Store a message (user prompt or agent response). */
export function insertMessage(groupFolder: string, role: "user" | "assistant", content: string): void {
  const stmt = getDb().prepare(
    "INSERT INTO messages (group_folder, role, content) VALUES (?, ?, ?)"
  );
  stmt.run(groupFolder, role, content);
}

/** Get the most recent N messages for a group, oldest first. */
export function getRecentMessages(groupFolder: string, limit = 20): Message[] {
  const stmt = getDb().prepare(`
    SELECT id, group_folder, role, content, timestamp
    FROM messages
    WHERE group_folder = ?
    ORDER BY timestamp DESC, id DESC
    LIMIT ?
  `);
  const rows = stmt.all(groupFolder, limit) as Message[];
  // Reverse so oldest is first (chronological order for the prompt)
  return rows.reverse();
}

/** Format messages into a string suitable for injection into the system prompt. */
export function formatHistory(messages: Message[]): string {
  if (messages.length === 0) return "";

  const lines = messages.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    return `[${m.timestamp}] ${role}: ${m.content}`;
  });

  return "# Recent Conversation History\n\n" + lines.join("\n\n");
}
