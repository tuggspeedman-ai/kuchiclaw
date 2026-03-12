# KuchiClaw

Minimal AI agent framework inspired by NanoClaw/OpenClaw. Node.js + TypeScript + Docker + Claude Agent SDK.

## Project Philosophy

- Understand every line of code — if it can be removed without breaking core functionality, remove it
- No premature abstraction — start concrete, refactor only when patterns emerge
- This is a portfolio project: clean code, meaningful comments (why not what), clear documentation

## Architecture

- Single Node.js process orchestrator (no microservices)
- Docker containers for agent isolation (each session = ephemeral container)
- Filesystem-based IPC (containers write JSON → host polls/validates/executes)
- SQLite for persistent state (messages, sessions, groups, tasks)
- Five living files: SOUL.md (identity, global, ro), TOOLS.md (capabilities, global, ro), MEMORY.md (durable facts, per-group, rw), CONTEXT.md (session scratchpad, per-group, rw), HEARTBEAT.md (scheduled self-maintenance tasks, global, ro — planned M7)
- Authentication via Claude Max OAuth token — read from env vars or macOS keychain, passed to containers via stdin (never mounted)
- Container runs as non-root `agent` user (Claude Code refuses bypassPermissions as root)
- Telegram as primary messaging channel

## Current State

M0 (scaffolding), M1 (basic agent loop), M2 (persistent context + web tools), M3 (SQLite + message history), M4 (Telegram integration), M5 (orchestrator + queue), and M6 (IPC + skills system) are complete. Next up: M7 (scheduled tasks + heartbeat).

Working flow (CLI): `npx tsx src/cli.ts "prompt"` or `npx tsx src/cli.ts --group mygroup "prompt"` → stores prompt in SQLite → loads recent message history → spawns ephemeral Docker container with living files mounted + message history injected → Claude Agent SDK runs inside with system prompt from SOUL.md + TOOLS.md + MEMORY.md + CONTEXT.md + recent messages → response returned via sentinel markers → response stored in SQLite. Use `--history` to view conversation log.

Working flow (Telegram): `npx tsx src/index.ts` (secrets loaded from `.env`) → orchestrator connects Telegram channel, starts IPC polling → incoming messages stored in SQLite and enqueued in per-group FIFO queue → queue drains up to `MAX_CONTAINERS_PER_GROUP` (default 2) concurrent containers per group → container runs agent with skills/ and ipc/ mounted → agent can write IPC requests to send messages proactively → response stored in SQLite and sent back to Telegram. MCP servers loaded from `mcp-servers.json` and passed to SDK. Failed containers retry with exponential backoff (max 3 attempts). Graceful shutdown on SIGINT/SIGTERM waits for running containers. All chats map to `main` group (M8 adds per-chat groups).

## Key Files

**Implemented (M0-M6):**
- `src/index.ts` — Main orchestrator entrypoint: connects Telegram channel, starts IPC polling, loads MCP config, routes messages through per-group queue, graceful shutdown on SIGINT/SIGTERM
- `src/group-queue.ts` — Per-group FIFO queue with per-group concurrency cap, exponential backoff retry, auth-failure detection
- `src/ipc.ts` — Filesystem-based IPC: polls `data/ipc/` for JSON requests from containers, validates and executes them, moves failures to `errors/`
- `src/cli.ts` — CLI entrypoint: reads prompt from args/stdin, gets auth token, supports `--group` and `--history` flags, stores messages in SQLite, injects recent history into container
- `src/auth.ts` — Authentication helpers: reads Claude auth tokens from env vars or macOS keychain, collects skill secrets (FASTMAIL_API_TOKEN) from env (shared by cli.ts and index.ts)
- `src/channels/registry.ts` — Channel interface definition (connect, sendMessage, isConnected, ownsJid, disconnect) + IncomingMessage type
- `src/channels/telegram.ts` — Telegram adapter: long polling via node-telegram-bot-api, /start and /status commands, message chunking, typing indicator
- `src/container-runner.ts` — Spawns `docker run -i --rm` with living file + IPC + skills mounts, passes ContainerInput via stdin, parses sentinel markers from stdout
- `src/db.ts` — SQLite database: `messages` table, insert/query functions, history formatting
- `src/group-folder.ts` — Manages per-group directory structure (MEMORY.md, CONTEXT.md, logs/) and ensures IPC directory exists
- `src/config.ts` — Constants: image name, sentinel markers, timeout, paths, queue config, IPC config, skills/MCP paths
- `src/types.ts` — ContainerInput/ContainerOutput/IpcRequest/McpServerConfig type definitions
- `container/entrypoint.ts` — Runs inside Docker: reads stdin, sets all secrets as env vars, builds system prompt from living files + message history, passes mcpServers to SDK `query()`, emits result between markers
- `container/package.json` — Container deps (claude-agent-sdk only)
- `Dockerfile` — Node 20 slim + git + claude-agent-sdk + tsx, runs as non-root `agent` user
- `SOUL.md` — Agent personality and behavior rules (global, read-only)
- `TOOLS.md` — Available tools documentation including IPC and skills (global, read-only)
- `mcp-servers.json` — MCP server configurations (empty by default, add servers as needed)
- `skills/` — Simple skills directory (CLI scripts/API wrappers, mounted read-only into containers). Includes `fastmail.mjs` (email via JMAP as koochi@fastmail.com)
- `groups/main/MEMORY.md` — Per-group durable memory (read-write)
- `groups/main/CONTEXT.md` — Per-group session scratchpad (read-write)
- `data/kuchiclaw.db` — SQLite database (auto-created on first run)
- `data/ipc/` — IPC request directory (containers write here, host polls)

**Planned (future milestones):**
- `src/task-scheduler.ts` — Cron/interval scheduled tasks (M7)

**Reference:**
- `project-plan.md` — Detailed milestones and architectural decisions

## Conventions

- TypeScript strict mode, ES modules
- Keep files under ~200 lines; split when they grow
- Minimal dependencies — host: better-sqlite3, node-telegram-bot-api, dotenv. Container: claude-agent-sdk (web tools are SDK built-in)
- Comments explain WHY, not WHAT
- No dashboards or web UIs — Telegram is the interface

## Task Tracking

- Plans go in `project-plan.md`
- Active tasks in `tasks/todo.md` with checkable items
- Check in before starting implementation
- Mark items complete as you go

## Security Model

- Containers are the security boundary — agents see only mounted directories
- Read-only mounts by default (MEMORY.md and CONTEXT.md are exceptions)
- Secrets passed via stdin, never mounted as files
- IPC requests validated before execution
- No personal account credentials — dedicated service accounts only
- `.env` file at project root for local secrets (gitignored). Loaded by `dotenv/config` in entrypoints. Contains `TELEGRAM_BOT_TOKEN`, `FASTMAIL_API_TOKEN`, etc.
