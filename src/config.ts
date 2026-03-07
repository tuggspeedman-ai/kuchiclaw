// Configuration constants for KuchiClaw

import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Project root directory */
export const PROJECT_ROOT = path.resolve(__dirname, "..");

/** Directory where group folders live */
export const GROUPS_DIR = path.join(PROJECT_ROOT, "groups");

/** Directory for persistent data (SQLite, IPC) */
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

/** Docker image name for agent containers */
export const CONTAINER_IMAGE = "kuchiclaw-agent";

/** Sentinel markers for parsing container output */
export const OUTPUT_START_MARKER = "---KUCHICLAW_OUTPUT_START---";
export const OUTPUT_END_MARKER = "---KUCHICLAW_OUTPUT_END---";

/** Container timeout in milliseconds (5 minutes default) */
export const CONTAINER_TIMEOUT_MS = 5 * 60 * 1000;
