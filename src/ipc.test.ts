import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { resetDb, insertTask } from "./db.js";
import { execute, registerSender } from "./ipc.js";
import type { IpcRequest } from "./types.js";

// Mock config — MAIN_CHAT_ID is channel-qualified
vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return { ...actual, MAIN_CHAT_ID: "tg-999" };
});

beforeEach(() => {
  resetDb(new Database(":memory:"));
});

describe("IPC authorization", () => {
  it("allows main group to message any chat", async () => {
    const sent: string[] = [];
    registerSender(async (_chatId, text) => { sent.push(text); });

    await execute({
      op: "message",
      chatId: "someone-else",
      group: "main",
      text: "hello from admin",
    });

    expect(sent).toContain("hello from admin");
  });

  it("allows non-main group to message its own chat", async () => {
    const sent: { chatId: string; text: string }[] = [];
    registerSender(async (chatId, text) => { sent.push({ chatId, text }); });

    await execute({
      op: "message",
      chatId: "123",
      group: "tg-123",
      text: "hello from my group",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe("hello from my group");
  });

  it("blocks non-main group from messaging a different chat", async () => {
    registerSender(async () => {});

    await expect(execute({
      op: "message",
      chatId: "456",
      group: "tg-123",
      text: "trying to reach another chat",
    })).rejects.toThrow(/Authorization denied/);
  });

  it("blocks non-main group from modifying another group's task", async () => {
    registerSender(async () => {});

    // Create a task belonging to "main"
    const taskId = insertTask("main", "999", "main's task", "once", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z");

    await expect(execute({
      op: "task_cancel",
      chatId: "123",
      group: "tg-123",
      taskId,
    })).rejects.toThrow(/Authorization denied/);
  });

  it("allows non-main group to manage its own tasks", async () => {
    const sent: string[] = [];
    registerSender(async (_chatId, text) => { sent.push(text); });

    // Create a task belonging to "tg-123"
    const taskId = insertTask("tg-123", "123", "my task", "once", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z");

    await execute({
      op: "task_cancel",
      chatId: "123",
      group: "tg-123",
      taskId,
    });

    expect(sent.some((s) => s.includes("completed"))).toBe(true);
  });

  it("allows main group to manage any group's tasks", async () => {
    const sent: string[] = [];
    registerSender(async (_chatId, text) => { sent.push(text); });

    const taskId = insertTask("tg-123", "123", "someone's task", "once", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z");

    await execute({
      op: "task_cancel",
      chatId: "999",
      group: "main",
      taskId,
    });

    expect(sent.some((s) => s.includes("completed"))).toBe(true);
  });
});
