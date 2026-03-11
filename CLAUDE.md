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

M0 (scaffolding), M1 (basic agent loop), M2 (persistent context + web tools), and M3 (SQLite + message history) are complete. Next up: M4 (Telegram integration).

Working flow: `npx tsx src/cli.ts "prompt"` or `npx tsx src/cli.ts --group mygroup "prompt"` → stores prompt in SQLite → loads recent message history → spawns ephemeral Docker container with living files mounted + message history injected → Claude Agent SDK runs inside with system prompt from SOUL.md + TOOLS.md + MEMORY.md + CONTEXT.md + recent messages → response returned via sentinel markers → response stored in SQLite. Use `--history` to view conversation log.

## Key Files

**Implemented (M0-M3):**
- `src/cli.ts` — CLI entrypoint: reads prompt from args/stdin, gets auth token, supports `--group` and `--history` flags, stores messages in SQLite, injects recent history into container
- `src/container-runner.ts` — Spawns `docker run -i --rm` with living file mounts, passes ContainerInput via stdin, parses sentinel markers from stdout
- `src/db.ts` — SQLite database: `messages` table, insert/query functions, history formatting
- `src/group-folder.ts` — Manages per-group directory structure (MEMORY.md, CONTEXT.md, logs/)
- `src/config.ts` — Constants: image name, sentinel markers, timeout, paths
- `src/types.ts` — ContainerInput/ContainerOutput type definitions
- `container/entrypoint.ts` — Runs inside Docker: reads stdin, builds system prompt from living files + message history, invokes Claude Agent SDK `query()`, emits result between markers
- `container/package.json` — Container deps (claude-agent-sdk only)
- `Dockerfile` — Node 20 slim + git + claude-agent-sdk + tsx, runs as non-root `agent` user
- `SOUL.md` — Agent personality and behavior rules (global, read-only)
- `TOOLS.md` — Available tools documentation (global, read-only)
- `groups/main/MEMORY.md` — Per-group durable memory (read-write)
- `groups/main/CONTEXT.md` — Per-group session scratchpad (read-write)
- `data/kuchiclaw.db` — SQLite database (auto-created on first run)

**Planned (future milestones):**
- `src/index.ts` — Main orchestrator with polling loop (M5)
- `src/ipc.ts` — Filesystem IPC (M6)
- `src/group-queue.ts` — Per-group FIFO queue (M5)
- `src/task-scheduler.ts` — Cron/interval scheduled tasks (M7)
- `src/channels/telegram.ts` — Telegram adapter (M4)

**Reference:**
- `project-plan.md` — Detailed milestones and architectural decisions

## Conventions

- TypeScript strict mode, ES modules
- Keep files under ~200 lines; split when they grow
- Minimal dependencies — host: better-sqlite3, node-telegram-bot-api, cron-parser. Container: claude-agent-sdk (web tools are SDK built-in)
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
