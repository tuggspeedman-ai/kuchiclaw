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
- Five living files: SOUL.md (identity, global, ro), TOOLS.md (capabilities, global, ro), MEMORY.md (durable facts, per-group, rw), CONTEXT.md (session scratchpad, per-group, rw), HEARTBEAT.md (self-maintenance checklist, global, ro)
- Authentication via Claude Max OAuth token with auto-refresh (`data/oauth.json`), fallback to `ANTHROPIC_API_KEY` env var (auto-downgrades to Sonnet 4.6 to reduce costs), then macOS keychain (local dev). Access token + refresh token passed to containers via stdin; containers refresh the token themselves (VPS host is Cloudflare-blocked from `platform.claude.com`, containers are not) and return new tokens in output for the host to persist
- Container runs as non-root `agent` user (Claude Code refuses bypassPermissions as root)
- Telegram as primary messaging channel

## Current State

M0 (scaffolding), M1 (basic agent loop), M2 (persistent context + web tools), M3 (SQLite + message history), M4 (Telegram integration), M5 (orchestrator + queue), M6 (IPC + skills system), M7 (scheduled tasks + heartbeat), M8 (multi-group isolation), M9 (deploy to Hetzner), M10 (crash recovery), and M11 (living file backup via git) are complete. **M9 + M10 + M11 = MVP.**

Working flow (CLI): `npx tsx src/cli.ts "prompt"` or `npx tsx src/cli.ts --group mygroup "prompt"` → stores prompt in SQLite → loads recent message history → spawns ephemeral Docker container with living files mounted + message history injected → Claude Agent SDK runs inside with system prompt from SOUL.md + TOOLS.md + MEMORY.md + CONTEXT.md + recent messages → response returned via sentinel markers → response stored in SQLite. Use `--history` to view conversation log.

Working flow (Telegram): `npx tsx src/index.ts` (secrets loaded from `.env`) → orchestrator connects Telegram channel, starts IPC polling, starts task scheduler (60s poll) → each Telegram chat maps to its own isolated group via `chatIdToGroup("tg", chatId)` — one chat designated as `MAIN_CHAT_ID` maps to `main`, all others get `tg-{chatId}` → incoming messages stored in SQLite and enqueued in per-group FIFO queue → queue drains up to `MAX_CONTAINERS_PER_GROUP` (default 2) concurrent containers per group → container runs agent with skills/, ipc/, and HEARTBEAT.md mounted, plus `## Session Context` in system prompt (group name + chat ID) → agent can write IPC requests to send messages or manage scheduled tasks → response stored in SQLite and sent back to Telegram. Scheduled tasks (cron/interval/one-shot) enqueue into the same GroupQueue. MCP servers loaded from `mcp-servers.json` and passed to SDK. Failed containers retry with exponential backoff (max 3 attempts). Graceful shutdown on SIGINT/SIGTERM waits for running containers. On startup, orphaned messages (pending/processing, 10s–1hr old) are detected and re-enqueued for crash recovery. Group chats require @mention to trigger the bot. Global sender allowlist via `ALLOWED_SENDER_IDS`. Non-main groups scoped to their own chat/tasks via IPC authorization; main group has full access.

## Key Files

**Implemented (M0-M8):**
- `src/index.ts` — Main orchestrator entrypoint: connects Telegram channel, starts IPC polling + task scheduler, loads MCP config, routes messages through per-group queue via chatIdToGroup, graceful shutdown on SIGINT/SIGTERM
- `src/group-queue.ts` — Per-group FIFO queue with per-group concurrency cap, exponential backoff retry, auth-failure detection, onComplete/onError callbacks for task logging. Calls `getSecrets()` per job (not at startup) so OAuth tokens stay fresh — access tokens expire after 8h and the process is long-lived
- `src/group-mapping.ts` — Maps channel chat IDs to group folder names (`chatIdToGroup`, `groupToChatId`). MAIN_CHAT_ID is channel-qualified (e.g., `tg-<your-chat-id>`)
- `src/ipc.ts` — Filesystem-based IPC: polls `data/ipc/` for JSON requests from containers, validates and executes them (message, task_create/pause/resume/cancel/list), two-tier authorization (main=unrestricted, others=scoped to own chat/tasks), moves failures to `errors/`
- `src/task-scheduler.ts` — Polls every 60s for due tasks, supports cron (via cron-parser), interval (with drift prevention), and one-shot schedules, enqueues into GroupQueue, in-flight tracking via Set
- `src/cli.ts` — CLI entrypoint: reads prompt from args/stdin, gets auth token, supports `--group` and `--history` flags, stores messages in SQLite, injects recent history into container
- `src/auth.ts` — Authentication helpers: resolves auth via OAuth auto-refresh → API key (with Sonnet downgrade) → keychain, returns `AuthResult` with secrets + `isApiKeyFallback` flag, collects skill secrets (FASTMAIL_API_TOKEN) from env (shared by cli.ts and index.ts)
- `src/oauth-refresh.ts` — OAuth token auto-refresh for Claude Max: reads/writes `data/oauth.json`, refreshes access token on demand when within 5 min of expiry, returns null on failure (caller falls back). Also exports `getRefreshToken()` and `updateOAuthData()` for the container-side refresh flow
- `src/channels/registry.ts` — Channel interface definition (connect, sendMessage, isConnected, ownsJid, disconnect) + IncomingMessage type (with chatType, senderId)
- `src/channels/telegram.ts` — Telegram adapter: long polling via node-telegram-bot-api, /start and /status commands, message chunking, MarkdownV2 rendering (with plain text fallback), typing indicator, @mention filtering for group chats, sender allowlist
- `src/container-runner.ts` — Spawns `docker run -i --rm` with living file + IPC + skills mounts, passes ContainerInput via stdin, parses sentinel markers from stdout. Persists `newTokens` from container output to `oauth.json` if the container refreshed them
- `src/db.ts` — SQLite database: `messages` (with `processing_status`/`chat_id`/`sender_name` for crash recovery), `scheduled_tasks`, `task_run_logs` tables, insert/query functions, history formatting, orphaned message detection, `resetDb()` for test injection
- `src/group-folder.ts` — Manages per-group directory structure (MEMORY.md, CONTEXT.md, logs/) and ensures IPC directory exists
- `src/config.ts` — Constants: image name, sentinel markers, timeout, paths, queue config, IPC config, skills/MCP paths, scheduler poll interval, MAIN_CHAT_ID, ALLOWED_SENDER_IDS
- `src/types.ts` — ContainerInput/ContainerOutput/IpcRequest (with task ops)/McpServerConfig/ScheduledTask/TaskRunLog type definitions
- `container/entrypoint.ts` — Runs inside Docker: reads stdin, sets all secrets as env vars, builds system prompt from living files (incl. HEARTBEAT.md) + Session Context (group + chatId) + message history, passes mcpServers to SDK `query()`, emits result between markers
- `container/package.json` — Container deps (claude-agent-sdk only)
- `Dockerfile` — Node 20 slim + git + claude-agent-sdk + tsx, runs as non-root `agent` user (uid 999, matching host `kuchiclaw` user for volume permissions)
- `SOUL.md` — Agent personality and behavior rules (global, read-only)
- `TOOLS.md` — Available tools documentation including IPC, skills, and scheduled tasks (global, read-only)
- `HEARTBEAT.md` — Self-maintenance checklist for heartbeat tasks (global, read-only)
- `mcp-servers.json` — MCP server configurations (empty by default, add servers as needed)
- `skills/` — Simple skills directory (CLI scripts/API wrappers, mounted read-only into containers). Includes `fastmail.mjs` (email via JMAP as koochi@fastmail.com), `backup.sh` (living file + SQLite backup to private git repo)
- `groups/example/` — Example living files for reference (tracked in git). Real groups are gitignored — created at runtime by `ensureGroupFolder()`
- `data/kuchiclaw.db` — SQLite database (auto-created on first run)
- `data/ipc/` — IPC request directory (containers write here, host polls)
- `data/oauth.json` — OAuth tokens for auto-refresh (accessToken, refreshToken, expiresAt; chmod 600, gitignored)

**Deployment (M9) + Backup (M11):**
- `kuchiclaw.service` — systemd unit file: runs as `kuchiclaw` user, `Restart=always` with `StartLimitBurst=5`/`StartLimitIntervalSec=300` so repeated crashes trip the unit into `failed` state and fire `OnFailure=kuchiclaw-alert@%n.service`. `EnvironmentFile=/opt/kuchiclaw/.env`, security hardening (NoNewPrivileges, ProtectSystem=strict, PrivateTmp=yes)
- `deploy/kuchiclaw-alert@.service` — Templated oneshot unit invoked by `OnFailure`. Runs `deploy/alert.sh` with the failed unit name as `%i`
- `deploy/alert.sh` — Telegram alert when systemd gives up restarting kuchiclaw. Curls Telegram's `sendMessage` API directly using `TELEGRAM_BOT_TOKEN` + `MAIN_CHAT_ID` from `.env`, includes last 20 journal lines. Has zero dependency on the kuchiclaw process — that's the whole point
- `deploy/setup.sh` — VPS provisioning script: installs Docker + Node.js 20, creates `kuchiclaw` user, clones repo, builds Docker image, installs both systemd units
- `deploy/export-oauth.sh` — Exports OAuth tokens from macOS keychain to `data/oauth.json` for transfer to VPS
- `deploy/kuchiclaw-backup.service` — systemd unit for daily living file + SQLite backup
- `deploy/kuchiclaw-backup.timer` — systemd timer triggering backup daily at 03:00 UTC

**Reference:**
- `project-plan.md` — Detailed milestones and architectural decisions

## Conventions

- TypeScript strict mode, ES modules
- Keep files under ~200 lines; split when they grow
- Minimal dependencies — host: better-sqlite3, node-telegram-bot-api, dotenv, cron-parser. Container: claude-agent-sdk (web tools are SDK built-in)
- Comments explain WHY, not WHAT
- No dashboards or web UIs — Telegram is the interface
- Tests via vitest (`npm test`). Test files colocated as `*.test.ts`. Use in-memory SQLite via `resetDb(new Database(":memory:"))` for DB tests.

## Task Tracking

- Plan in `project-plan.md` (gitignored, internal working doc — checklists, implementation order, in-progress decisions)
- Build, then update `ARCHITECTURE.md` (public, polished) with the clean version once a phase or major decision is complete
- Active tasks in `tasks/todo.md` with checkable items
- Check in before starting implementation
- Mark items complete as you go

## Security Model

- Containers are the security boundary — agents see only mounted directories
- Read-only mounts by default (MEMORY.md and CONTEXT.md are exceptions)
- Secrets passed via stdin, never mounted as files
- IPC requests validated before execution
- No personal account credentials — dedicated service accounts only
- `.env` file at project root for local secrets (gitignored). Loaded by `dotenv/config` in entrypoints. Contains `TELEGRAM_BOT_TOKEN`, `FASTMAIL_API_TOKEN`, `MAIN_CHAT_ID` (channel-qualified, e.g., `tg-<your-chat-id>`), `ALLOWED_SENDER_IDS` (comma-separated, optional).
- `data/oauth.json` stores OAuth tokens (chmod 600, gitignored). Never mounted into containers.
- Production: dedicated `kuchiclaw` system user owns `/opt/kuchiclaw/`, runs the systemd service, is in `docker` group. `.env` and `data/oauth.json` are chmod 600.
- `groups/` is gitignored in the main repo — agent memory is backed up to a separate private `kuchiclaw-memory` repo via `skills/backup.sh` on a systemd timer. This prevents `git pull` deployments from overwriting the agent's evolved memory.
- Backup git auth via private GitHub App: short-lived tokens (1hr), scoped `contents: write` on one repo. App private key stored on host at `data/github-app/`, never enters containers.
