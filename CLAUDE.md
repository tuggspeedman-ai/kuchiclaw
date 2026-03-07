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
- Four living files: SOUL.md (identity, global, ro), TOOLS.md (capabilities, global, ro), MEMORY.md (durable facts, per-group, rw), CONTEXT.md (session scratchpad, per-group, rw)
- Authentication via Claude Max OAuth token — read from env vars or macOS keychain, passed to containers via stdin (never mounted)
- Container runs as non-root `agent` user (Claude Code refuses bypassPermissions as root)
- Telegram as primary messaging channel

## Current State

M0 (scaffolding) and M1 (basic agent loop) are complete. Next up: M2 (persistent context + web tools).

Working flow: `npx tsx src/cli.ts "prompt"` → spawns ephemeral Docker container → Claude Agent SDK runs inside → response returned via sentinel markers.

## Key Files

**Implemented (M0-M1):**
- `src/cli.ts` — CLI entrypoint: reads prompt from args/stdin, gets auth token, calls container runner
- `src/container-runner.ts` — Spawns `docker run -i --rm`, passes ContainerInput via stdin, parses sentinel markers from stdout
- `src/config.ts` — Constants: image name, sentinel markers, timeout
- `src/types.ts` — ContainerInput/ContainerOutput type definitions
- `container/entrypoint.ts` — Runs inside Docker: reads stdin, invokes Claude Agent SDK `query()`, emits result between markers
- `container/package.json` — Container deps (claude-agent-sdk only)
- `Dockerfile` — Node 20 slim + git + claude-agent-sdk + tsx, runs as non-root `agent` user

**Planned (future milestones):**
- `src/index.ts` — Main orchestrator with polling loop (M5)
- `src/db.ts` — SQLite schema and queries (M3)
- `src/ipc.ts` — Filesystem IPC (M6)
- `src/group-queue.ts` — Per-group FIFO queue (M5)
- `src/task-scheduler.ts` — Cron/interval scheduled tasks (M7)
- `src/channels/telegram.ts` — Telegram adapter (M4)

**Reference:**
- `project-plan.md` — Detailed milestones and architectural decisions

## Conventions

- TypeScript strict mode, ES modules
- Keep files under ~200 lines; split when they grow
- Minimal dependencies — host: better-sqlite3, node-telegram-bot-api, cron-parser. Container: claude-agent-sdk, web tool SDKs
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
