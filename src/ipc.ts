// Filesystem-based IPC — polls a directory for JSON request files written
// by containers, validates and executes them, then deletes processed files.
// Failed requests are moved to an errors/ subdirectory.

import fs from "node:fs";
import path from "node:path";
import { CronExpressionParser } from "cron-parser";
import { IPC_DIR, IPC_ERRORS_DIR, IPC_POLL_MS } from "./config.js";
import { insertTask, updateTaskStatus, getTasksByGroup } from "./db.js";
import type { IpcRequest } from "./types.js";

/** Callback registry — the orchestrator registers channels so IPC can send messages */
let sendMessage: ((chatId: string, text: string) => Promise<void>) | null = null;

/** Register the send function that IPC uses to deliver messages */
export function registerSender(fn: (chatId: string, text: string) => Promise<void>): void {
  sendMessage = fn;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Start polling the IPC directory for request files */
export function startPolling(): void {
  // Ensure directories exist
  fs.mkdirSync(IPC_DIR, { recursive: true });
  fs.mkdirSync(IPC_ERRORS_DIR, { recursive: true });

  pollTimer = setInterval(poll, IPC_POLL_MS);
  console.log(`[IPC] Polling ${IPC_DIR} every ${IPC_POLL_MS}ms`);
}

/** Stop polling */
export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[IPC] Polling stopped");
  }
}

/** Single poll cycle: read all .json files, process, delete */
async function poll(): Promise<void> {
  let files: string[];
  try {
    files = fs.readdirSync(IPC_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return; // Directory might not exist yet
  }

  for (const file of files) {
    const filePath = path.join(IPC_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const request = JSON.parse(raw) as IpcRequest;
      await execute(request);
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`[IPC] Error processing ${file}:`, err);
      moveToErrors(filePath, file, err);
    }
  }
}

/** Execute a validated IPC request */
async function execute(request: IpcRequest): Promise<void> {
  // Validate required fields
  if (!request.op || !request.chatId || !request.group) {
    throw new Error(`Invalid IPC request: missing required fields (op, chatId, group)`);
  }

  switch (request.op) {
    case "message":
      if (!request.text) throw new Error("IPC message op requires 'text' field");
      if (!sendMessage) throw new Error("No message sender registered — is a channel connected?");
      console.log(`[IPC] Sending message to chat ${request.chatId} (group: ${request.group})`);
      await sendMessage(request.chatId, request.text);
      break;

    case "task_create":
      await handleTaskCreate(request);
      break;

    case "task_pause":
    case "task_resume":
    case "task_cancel":
      await handleTaskStatusChange(request);
      break;

    case "task_list":
      await handleTaskList(request);
      break;

    default:
      throw new Error(`Unknown IPC operation: ${request.op}`);
  }
}

// --- Task IPC handlers ---

async function handleTaskCreate(req: IpcRequest): Promise<void> {
  if (!req.prompt) throw new Error("task_create requires 'prompt'");
  if (!req.scheduleType) throw new Error("task_create requires 'scheduleType'");
  if (!req.scheduleValue) throw new Error("task_create requires 'scheduleValue'");

  // Compute initial next_run
  let nextRun: string;
  switch (req.scheduleType) {
    case "cron": {
      // Validate cron expression and compute first run
      const expr = CronExpressionParser.parse(req.scheduleValue, { tz: "UTC" });
      nextRun = expr.next().toDate().toISOString();
      break;
    }
    case "interval": {
      const ms = parseInt(req.scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) throw new Error(`Invalid interval: ${req.scheduleValue}`);
      nextRun = new Date(Date.now() + ms).toISOString();
      break;
    }
    case "once": {
      // scheduleValue is an ISO timestamp
      const d = new Date(req.scheduleValue);
      if (isNaN(d.getTime())) throw new Error(`Invalid date: ${req.scheduleValue}`);
      nextRun = d.toISOString();
      break;
    }
  }

  const taskId = insertTask(
    req.group, req.chatId, req.prompt,
    req.scheduleType, req.scheduleValue, nextRun, req.label,
  );

  const label = req.label ? ` "${req.label}"` : "";
  const msg = `Task ${taskId}${label} created (${req.scheduleType}). Next run: ${nextRun}`;
  console.log(`[IPC] ${msg}`);
  if (sendMessage) await sendMessage(req.chatId, msg);
}

async function handleTaskStatusChange(req: IpcRequest): Promise<void> {
  if (!req.taskId) throw new Error(`${req.op} requires 'taskId'`);

  const statusMap = {
    task_pause: "paused" as const,
    task_resume: "active" as const,
    task_cancel: "completed" as const,
  };
  const newStatus = statusMap[req.op as keyof typeof statusMap];
  const updated = updateTaskStatus(req.taskId, newStatus);

  if (!updated) throw new Error(`Task ${req.taskId} not found`);

  const msg = `Task ${req.taskId} → ${newStatus}`;
  console.log(`[IPC] ${msg}`);
  if (sendMessage) await sendMessage(req.chatId, msg);
}

async function handleTaskList(req: IpcRequest): Promise<void> {
  const tasks = getTasksByGroup(req.group);

  if (tasks.length === 0) {
    if (sendMessage) await sendMessage(req.chatId, "No scheduled tasks.");
    return;
  }

  const lines = tasks.map((t) => {
    const label = t.label ? ` "${t.label}"` : "";
    return `#${t.id}${label} [${t.status}] ${t.schedule_type}(${t.schedule_value}) next: ${t.next_run ?? "—"}`;
  });

  if (sendMessage) await sendMessage(req.chatId, `Scheduled tasks:\n${lines.join("\n")}`);
}

/** Move a failed request file to the errors directory with error info */
function moveToErrors(filePath: string, fileName: string, err: unknown): void {
  try {
    const errorInfo = {
      originalFile: fileName,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
      content: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "(file already deleted)",
    };

    const errorPath = path.join(IPC_ERRORS_DIR, `${Date.now()}-${fileName}`);
    fs.writeFileSync(errorPath, JSON.stringify(errorInfo, null, 2));

    // Remove the original file so we don't reprocess it
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (moveErr) {
    console.error(`[IPC] Failed to move error file: ${moveErr}`);
  }
}
