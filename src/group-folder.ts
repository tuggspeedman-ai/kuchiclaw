// Manages per-group directory structure.
// Each group gets its own folder with MEMORY.md, CONTEXT.md, and logs/.

import fs from "node:fs";
import path from "node:path";
import { GROUPS_DIR, PROJECT_ROOT } from "./config.js";

export interface GroupPaths {
  /** Root of this group's folder (e.g., groups/main/) */
  root: string;
  /** Per-group durable memory file */
  memory: string;
  /** Per-group session scratchpad */
  context: string;
  /** Container log directory */
  logs: string;
  /** Global SOUL.md (read-only, shared across groups) */
  soul: string;
  /** Global TOOLS.md (read-only, shared across groups) */
  tools: string;
}

/** Ensure a group folder exists with all required files, return paths. */
export function ensureGroupFolder(groupName: string): GroupPaths {
  const root = path.join(GROUPS_DIR, groupName);
  const paths: GroupPaths = {
    root,
    memory: path.join(root, "MEMORY.md"),
    context: path.join(root, "CONTEXT.md"),
    logs: path.join(root, "logs"),
    soul: path.join(PROJECT_ROOT, "SOUL.md"),
    tools: path.join(PROJECT_ROOT, "TOOLS.md"),
  };

  // Create group directory and logs/
  fs.mkdirSync(paths.logs, { recursive: true });

  // Seed MEMORY.md if it doesn't exist
  if (!fs.existsSync(paths.memory)) {
    fs.writeFileSync(paths.memory, "# Memory\n\n## Lessons\n\n## Facts\n");
  }

  // Seed CONTEXT.md if it doesn't exist
  if (!fs.existsSync(paths.context)) {
    fs.writeFileSync(paths.context, "# Context\n\nSession scratchpad.\n");
  }

  return paths;
}
