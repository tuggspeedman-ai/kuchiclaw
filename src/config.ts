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

/** Max concurrent containers per group (per-group FIFO queue) */
export const MAX_CONTAINERS_PER_GROUP = 2;

/** Max retry attempts for failed container runs */
export const MAX_RETRIES = 3;

/** Base delay for exponential backoff on retries (ms). Delay = BASE_RETRY_MS * 2^(attempt-1) */
export const BASE_RETRY_MS = 2000;

/** Hard timeout for graceful shutdown — kill remaining containers after this (ms) */
export const SHUTDOWN_TIMEOUT_MS = 60 * 1000;

/** Directory for IPC request files (containers write here, host polls) */
export const IPC_DIR = path.join(DATA_DIR, "ipc");

/** IPC polling interval (ms) */
export const IPC_POLL_MS = 1000;

/** Directory for failed IPC requests */
export const IPC_ERRORS_DIR = path.join(IPC_DIR, "errors");

/** Skills directory — CLI scripts/API wrappers mounted into containers */
export const SKILLS_DIR = path.join(PROJECT_ROOT, "skills");

/** MCP server config file */
export const MCP_SERVERS_PATH = path.join(PROJECT_ROOT, "mcp-servers.json");

/** Task scheduler polling interval (ms) */
export const SCHEDULER_POLL_MS = 60_000;
