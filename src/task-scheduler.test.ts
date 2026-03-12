import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import {
  resetDb,
  insertTask,
  updateTaskNextRun,
  updateTaskStatus,
  getDueTasks,
  getTasksByGroup,
} from "./db.js";

beforeEach(() => {
  resetDb(new Database(":memory:"));
});

describe("interval drift prevention", () => {
  it("advances next_run from previous scheduled time, not now", () => {
    // Task was supposed to run at 10:00, interval is 1 hour
    const scheduledTime = "2026-03-12T10:00:00.000Z";
    const intervalMs = 3600_000; // 1 hour

    // Simulate: advance from scheduled time, not Date.now()
    const next = new Date(new Date(scheduledTime).getTime() + intervalMs).toISOString();
    expect(next).toBe("2026-03-12T11:00:00.000Z");
  });

  it("skips forward if fallen behind", () => {
    // Task was supposed to run at 10:00, but it's now 12:30. Interval = 1h.
    // Should skip to 13:00, not 11:00.
    const scheduledTime = "2026-03-12T10:00:00.000Z";
    const intervalMs = 3600_000;
    const now = new Date("2026-03-12T12:30:00.000Z").getTime();

    let next = new Date(scheduledTime).getTime() + intervalMs;
    while (next <= now) next += intervalMs;

    expect(new Date(next).toISOString()).toBe("2026-03-12T13:00:00.000Z");
  });

  it("handles exact boundary (next_run + interval === now)", () => {
    const scheduledTime = "2026-03-12T10:00:00.000Z";
    const intervalMs = 3600_000;
    const now = new Date("2026-03-12T11:00:00.000Z").getTime();

    let next = new Date(scheduledTime).getTime() + intervalMs;
    while (next <= now) next += intervalMs;

    // At exact boundary, should advance one more interval
    expect(new Date(next).toISOString()).toBe("2026-03-12T12:00:00.000Z");
  });
});

describe("cron next_run computation", () => {
  it("computes next run for a simple cron expression", () => {
    const expr = CronExpressionParser.parse("0 */6 * * *", {
      currentDate: new Date("2026-03-12T10:00:00Z"),
      tz: "UTC",
    });
    const next = expr.next().toDate().toISOString();
    expect(next).toBe("2026-03-12T12:00:00.000Z");
  });

  it("wraps to next day when no more matches today", () => {
    const expr = CronExpressionParser.parse("0 8 * * *", {
      currentDate: new Date("2026-03-12T09:00:00Z"),
      tz: "UTC",
    });
    const next = expr.next().toDate().toISOString();
    // 8am already passed (current is 9am), next is tomorrow 8am
    expect(next).toBe("2026-03-13T08:00:00.000Z");
  });

  it("rejects invalid cron expressions", () => {
    expect(() => CronExpressionParser.parse("not a cron")).toThrow();
  });
});

describe("one-shot tasks", () => {
  it("one-shot task is due when next_run is in the past", () => {
    insertTask("main", "chat1", "do once", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    const due = getDueTasks(new Date().toISOString());
    expect(due).toHaveLength(1);
  });

  it("one-shot task should be marked completed after execution", () => {
    const id = insertTask("main", "chat1", "do once", "once", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
    // Simulate what advanceNextRun does for one-shot
    updateTaskStatus(id, "completed");

    const due = getDueTasks(new Date().toISOString());
    expect(due).toHaveLength(0);

    const all = getTasksByGroup("main");
    expect(all[0].status).toBe("completed");
  });
});
