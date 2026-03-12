import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  resetDb,
  getDb,
  insertTask,
  getDueTasks,
  getTasksByGroup,
  updateTaskStatus,
  updateTaskNextRun,
  insertTaskRunLog,
} from "./db.js";

// Each test gets a fresh in-memory DB with schema applied
beforeEach(() => {
  resetDb(new Database(":memory:"));
});

describe("scheduled_tasks CRUD", () => {
  it("inserts a task and returns its ID", () => {
    const id = insertTask("main", "chat1", "do stuff", "once", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "test task");
    expect(id).toBe(1);
  });

  it("getDueTasks returns tasks whose next_run is in the past", () => {
    insertTask("main", "chat1", "past task", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    insertTask("main", "chat1", "future task", "once", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z");

    const due = getDueTasks(new Date().toISOString());
    expect(due).toHaveLength(1);
    expect(due[0].prompt).toBe("past task");
  });

  it("getDueTasks excludes paused and completed tasks", () => {
    const id1 = insertTask("main", "chat1", "paused", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    const id2 = insertTask("main", "chat1", "completed", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    insertTask("main", "chat1", "active", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");

    updateTaskStatus(id1, "paused");
    updateTaskStatus(id2, "completed");

    const due = getDueTasks(new Date().toISOString());
    expect(due).toHaveLength(1);
    expect(due[0].prompt).toBe("active");
  });

  it("getTasksByGroup returns all tasks for a group regardless of status", () => {
    insertTask("main", "chat1", "task1", "cron", "0 * * * *", "2020-01-01T00:00:00Z");
    insertTask("main", "chat1", "task2", "interval", "3600000", "2020-01-01T00:00:00Z");
    insertTask("other", "chat2", "task3", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");

    expect(getTasksByGroup("main")).toHaveLength(2);
    expect(getTasksByGroup("other")).toHaveLength(1);
    expect(getTasksByGroup("nonexistent")).toHaveLength(0);
  });

  it("updateTaskStatus returns false for nonexistent task", () => {
    expect(updateTaskStatus(999, "paused")).toBe(false);
  });

  it("updateTaskNextRun changes the next_run value", () => {
    const id = insertTask("main", "chat1", "task", "interval", "60000", "2026-01-01T00:00:00Z");
    updateTaskNextRun(id, "2026-01-01T01:00:00Z");

    const tasks = getTasksByGroup("main");
    expect(tasks[0].next_run).toBe("2026-01-01T01:00:00Z");
  });
});

describe("task_run_logs", () => {
  it("logs a successful run", () => {
    const taskId = insertTask("main", "chat1", "task", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    insertTaskRunLog(taskId, 1500, "success", "all good");

    // Verify via raw query (no dedicated getter needed yet)
    const db = getDb();
    const logs = db.prepare("SELECT * FROM task_run_logs WHERE task_id = ?").all(taskId) as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].duration_ms).toBe(1500);
    expect(logs[0].status).toBe("success");
    expect(logs[0].result).toBe("all good");
  });

  it("logs an error run", () => {
    const taskId = insertTask("main", "chat1", "task", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    insertTaskRunLog(taskId, 500, "error", undefined, "container crashed");

    const db = getDb();
    const logs = db.prepare("SELECT * FROM task_run_logs WHERE task_id = ?").all(taskId) as any[];
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("error");
    expect(logs[0].error).toBe("container crashed");
  });
});
