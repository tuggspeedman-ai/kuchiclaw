# KuchiClaw — Project Plan

## Research Summary

### NanoClaw Architecture (Our Primary Reference)

NanoClaw is a ~3,900-line Node.js/TypeScript framework with these core components:

**Orchestrator (`index.ts`, ~17.6KB):** A single-process polling loop that:
- Polls SQLite for new messages every 2s across all registered groups
- Routes messages to per-group queues
- Manages agent sessions (stores session IDs in memory + SQLite)
- Handles crash recovery by re-enqueuing unprocessed messages
- Cursor-based message tracking with rollback on failure

**Container Runner (`container-runner.ts`, ~21.3KB):** Spawns isolated Docker containers:
- `docker run -i --rm --name nanoclaw-{group}-{timestamp}`
- Mounts: group folder (rw), project root (ro), IPC directories, Claude settings
- Passes secrets via stdin (never mounted as files)
- Claude Agent SDK runs inside the container
- Output captured via sentinel markers (`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---`)
- Configurable timeouts (default 30min), idle detection, graceful shutdown

**IPC (`ipc.ts`, ~12.4KB):** Filesystem-based inter-process communication:
- Containers write JSON files to mounted `/workspace/ipc/` directories
- Host polls every 1s, validates, executes, deletes processed files
- Two-tier auth: main group has full access, non-main groups scoped to own data
- Operations: send messages, schedule/pause/resume/cancel tasks, register groups
- Failed files moved to `errors/` directory

**Group Queue (`group-queue.ts`, ~10.7KB):** Per-group FIFO with concurrency:
- `MAX_CONCURRENT_CONTAINERS` limit (default 5)
- Exponential backoff retry: `BASE_RETRY_MS * 2^(retryCount-1)`, max 5 retries
- Tasks prioritized over message processing in drain operations
- Active stdin piping for messages to running containers

**Database (`db.ts`, ~19.5KB):** SQLite with tables:
- `chats` (jid, name, channel, is_group)
- `messages` (id, chat_jid, sender, content, timestamp, is_from_me, is_bot_message)
- `scheduled_tasks` (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status)
- `task_run_logs` (task_id, run_at, duration_ms, status, result, error)
- `registered_groups` (folder, name, trigger, container config)
- `sessions` (group_folder → session_id mapping)

**Task Scheduler (`task-scheduler.ts`, ~8KB):** Polls every 60s:
- Cron (via `CronExpressionParser`), interval, one-shot
- Drift prevention: interval tasks advance from previous scheduled time, not `Date.now()`
- Tasks enqueue into GroupQueue, maintaining execution isolation
- Results forwarded to task's chat via `sendMessage()`

**Per-Group Memory:** Each group gets a folder under `groups/` containing:
- `CLAUDE.md` — persistent context loaded into every agent session
- `logs/` — container execution logs
- IPC directories for message/task communication

### OpenClaw Architecture Patterns (High-Level Reference)

**Living Files / Workspace:**
- `SOUL.md` — personality, tone, behavioral boundaries (loaded every session)
- `AGENTS.md` — operating instructions for the agent (loaded every session)
- `USER.md` — user identity and communication preferences
- `MEMORY.md` — curated long-term memory (loaded only in private sessions)
- `memory/YYYY-MM-DD.md` — daily append-only logs (today + yesterday loaded)
- `HEARTBEAT.md` — checklist for scheduled heartbeat runs
- `TOOLS.md` — documentation of available tools

**Key Patterns:**
- Gateway pattern: single daemon owns all messaging surfaces
- Context compaction: auto-summarize old messages near context limit
- Memory flush before compaction: silent turn to persist important info
- Per-session async locks prevent race conditions
- Channel adapters normalize messages to common format

### Claude Agent SDK

**TypeScript package:** `@anthropic-ai/claude-agent-sdk`

Two usage modes:
1. `query()` — one-off stateless sessions (async iterator)
2. `ClaudeSDKClient` — multi-turn stateful sessions

Key options: `allowedTools`, `permissionMode`, `systemPrompt`, `model`, `resume` (session ID), `mcpServers`

Built-in tools: Read, Edit, Write, Glob, Grep, Bash, WebSearch

---

## Architectural Decisions for KuchiClaw

### Decision 1: Container Strategy

**NanoClaw approach:** Runs the Claude Agent SDK inside Docker containers via a custom Docker image with an entrypoint script.

**KuchiClaw approach:** Same. The container IS the security boundary. Each agent invocation gets its own ephemeral container with only explicitly mounted paths visible.

### Decision 2: Memory / Living Files

**OpenClaw** uses 6+ markdown files (SOUL.md, AGENTS.md, USER.md, MEMORY.md, daily logs, HEARTBEAT.md, TOOLS.md).

**NanoClaw** simplifies to a single `CLAUDE.md` per group folder.

**KuchiClaw approach:** Four-file system:
- `SOUL.md` — static personality, behavior rules, boundaries. Read-only mount. **Global** (one file at project root, shared by all groups).
- `TOOLS.md` — documents available tools, usage patterns, and constraints. Read-only mount. Global. Updated as we add new tools.
- `MEMORY.md` — per-group long-lived curated facts (user preferences, key decisions, important knowledge). Read-write mount. Only grows with durable information. The agent's persistent memory.
- `CONTEXT.md` — per-group session working memory. Read-write mount. Scratchpad for session notes and running context. Can be compacted or rotated without losing anything valuable.

**Why four files?** Clean separation of concerns across two dimensions:

| | Global | Per-group |
|---|---|---|
| **Static reference** | SOUL.md (identity), TOOLS.md (capabilities) | — |
| **Durable memory** | — | MEMORY.md (curated facts) |
| **Working memory** | — | CONTEXT.md (session scratchpad) |

- SOUL.md and TOOLS.md are the same for every session, every group
- MEMORY.md accumulates slowly with important facts — survives compaction
- CONTEXT.md is the session scratchpad — can be flushed/rotated freely

### Decision 3: IPC Mechanism

**NanoClaw approach:** Filesystem-based JSON polling (container writes JSON → host polls → validates → executes → deletes).

**KuchiClaw approach:** Same. This is elegant and simple — no sockets, no HTTP servers inside containers. The container's only way to affect the outside world is writing files to a mounted directory.

### Decision 4: Database

SQLite via `better-sqlite3`. Synchronous API is fine for a single-process orchestrator and simpler than async alternatives.

### Decision 5: Channel Abstraction

Start with Telegram only, but design a minimal `Channel` interface from the start (NanoClaw's is just 5 methods: `connect`, `sendMessage`, `isConnected`, `ownsJid`, `disconnect`). This makes adding WhatsApp later straightforward without over-engineering now.

### Decision 6: Authentication (Claude Max)

NanoClaw supports `CLAUDE_CODE_OAUTH_TOKEN` — the same OAuth token used by Claude Max subscriptions. The token is passed to containers via stdin (never written to disk or mounted as files).

**KuchiClaw approach:** Use Claude Max OAuth token. The host reads the token from the local Claude Code config and passes it to each container via stdin. No API key billing.

### Decision 7: Container Runtime

**Docker only.** No Apple Container abstraction. Docker is required for DigitalOcean (Linux) production deployment anyway. If Apple Container support is wanted later, the refactor point is small — just the `docker run` invocation in `container-runner.ts`.

### Decision 8: Web Tools for the Agent

The agent needs to search the web and extract content from URLs. Rather than bundling a full browser (Chromium = ~400MB), we use lightweight API-based tools:

- **Tavily** — AI-optimized web search API. Returns clean, structured results. Free tier: 1000 searches/month.
- **Firecrawl** — URL content extraction API. Converts web pages to clean markdown. Free tier available.

These run as MCP tools or custom tools inside the container. The container only needs outbound HTTPS access to their APIs — no browser required. This keeps the container image lean (~300MB vs ~700MB+).

**Alternative considered:** Claude Agent SDK's built-in `WebSearch` tool. We may use this instead of or alongside Tavily depending on what's available inside containerized sessions. We'll evaluate during Milestone 2 implementation.

### Decision 9: Session Continuity (Options B+C)

The problem: if a user says "Plan a trip to Japan", then "Check the cron job", then "What about hotels for the Japan trip?" — how does the agent connect message 3 back to message 1?

**Three approaches considered:**
- **Option A: Always resume last session** — Simple but breaks on interleaved topics (message 3 would resume the cron job session)
- **Option B: Living files as the safety net** — MEMORY.md has durable facts ("planning Japan trip"). Even without session continuity, the agent knows about the trip. Living files are the *primary* memory mechanism.
- **Option C: Recent message history in the prompt** — Include the last N messages from SQLite in the prompt. Claude sees "1. Japan trip, 2. Cron job, 3. Hotels for Japan" and naturally connects 1 and 3. This is how most chat-based AI apps work.

**KuchiClaw approach: B+C combined.** No session ID resumption. Each invocation is a fresh container. Continuity comes from two sources working together:
1. **MEMORY.md** — durable facts persist across all sessions ("User is planning a trip to Japan, interested in Tokyo and Kyoto")
2. **Recent message history** — last N messages from SQLite injected into the prompt, giving Claude conversational context to connect related topics

This means session resumption is an *optimization* we can add later (see Future Enhancements), not a requirement. The system works without it.

### Decision 10: Context Compaction Strategy

**NanoClaw** has no compaction — it relies on ephemeral sessions and CLAUDE.md for persistent context.

**OpenClaw** uses two-phase compaction:
1. Pre-compaction memory flush: silent agentic turn writes important facts to disk
2. Compaction: old messages summarized into single entry, recent messages kept intact
3. Triggers: context overflow error (reactive) or `contextTokens > contextWindow - reserveTokens` (proactive)

**KuchiClaw approach — phased:**

**Phase 1 (M2):** Each container invocation is a fresh session. The agent is instructed to:
- Write durable facts (preferences, decisions, key knowledge) to MEMORY.md
- Write corrections and behavioral preferences to MEMORY.md `## Lessons` section immediately (Behavior Loop pattern — inspired by jumperz's agent memory framework)
- Write session notes and running context to CONTEXT.md
- MEMORY.md grows slowly with important info; CONTEXT.md is the scratchpad

**Phase 2 (M5, when orchestrator exists):** Add pre-session context flush. Before a session ends, prompt the agent to persist anything important from the conversation to MEMORY.md. CONTEXT.md can then be safely rotated or compacted.

**Phase 3 (Post-M8, if needed):** Full in-session compaction — summarize old messages, keep recent ones, triggered when approaching context limits. Only worth building if sessions regularly hit context window limits.

---

## Milestones

### Milestone 0: Project Scaffolding ✅
**Goal:** Empty but runnable TypeScript project with Docker setup.

- [x] Initialize npm project with TypeScript
- [x] Configure tsconfig.json (strict mode, ES modules)
- [x] Set up basic project structure: `src/`, `groups/`, `data/`, `tasks/`
- [x] Create Dockerfile for agent container (Node.js + Claude Agent SDK)
- [x] Create docker-compose.yml for easy local builds
- [x] Write initial README.md with project description
- [x] Initialize git repo

**Deliverable:** `npm run build` succeeds, `docker build` produces a working image (660MB).

### Milestone 1: Basic Agent Loop (CLI) ✅
**Goal:** Prove container isolation + IPC works end-to-end.

- [x] Build the container runner: spawn Docker container with proper mounts
- [x] Implement stdin/stdout communication with sentinel markers
- [x] Write the in-container agent runner (receives prompt via stdin, invokes Claude Agent SDK, outputs response via stdout markers)
- [x] Create a CLI script (`cli.ts`) that takes text from stdin, runs agent in container, prints response
- [x] Implement basic IPC: container writes response JSON to mounted directory
- [x] Host reads and displays the response

**Deliverable:** `echo "What is 2+2?" | npx tsx src/cli.ts` → spawns container → returns Claude's answer.

**Key files:** `src/cli.ts`, `src/container-runner.ts`, `container/entrypoint.ts`

### Milestone 2: Persistent Context + Web Tools
**Goal:** Agent remembers things across invocations and can search the web.

**Living Files:**
- [ ] Create global `SOUL.md` template with default personality/rules
- [ ] Create global `TOOLS.md` documenting available tools and usage patterns
- [ ] Create group folder structure with per-group `MEMORY.md` and `CONTEXT.md`
- [ ] Mount `SOUL.md` and `TOOLS.md` read-only, `MEMORY.md` and `CONTEXT.md` read-write into container
- [ ] Instruct agent (via SOUL.md) to write durable facts to MEMORY.md and session notes to CONTEXT.md
- [ ] MEMORY.md structure: `## Lessons` (corrections/preferences) + `## Facts` (knowledge). Agent writes corrections to Lessons immediately (Behavior Loop pattern)
- [ ] CLI now supports a `--group` flag to use different group folders
- [ ] Verify persistence: tell agent a preference, ask about it in next invocation, confirm it's in MEMORY.md

**Web Tools:**
- [ ] Evaluate Claude Agent SDK built-in `WebSearch` in container context
- [ ] Set up Tavily API for web search (if built-in insufficient)
- [ ] Set up Firecrawl API for URL content extraction
- [ ] Register web tools as MCP tools or custom tools available to the agent
- [ ] Pass web tool API keys via stdin alongside Claude auth token
- [ ] Update `TOOLS.md` with web search/extraction usage docs
- [ ] Verify: ask agent a question requiring web search, confirm it works

**Deliverable:** Agent remembers facts across invocations and can search/extract web content.

**Key files:** `src/group-folder.ts`, `SOUL.md`, `TOOLS.md`, `groups/main/MEMORY.md`, `groups/main/CONTEXT.md`

### Milestone 3: SQLite + Message History
**Goal:** Persist messages in a database and use recent history as context.

- [ ] Set up SQLite with `better-sqlite3`
- [ ] Create schema: `messages`, `registered_groups` tables
- [ ] Store all messages (user input + agent responses) with timestamps and group ID
- [ ] On each invocation, load recent message history from SQLite and include in the prompt
- [ ] CLI can show conversation history with `--history` flag

**Context strategy:** No session resumption — each container is a fresh session. Continuity comes from:
1. Recent message history from SQLite injected into the prompt
2. MEMORY.md for durable facts
3. CONTEXT.md for session scratchpad

**Deliverable:** Messages survive process restarts. Agent sees recent conversation history.

**Key files:** `src/db.ts`

### Milestone 4: Telegram Integration
**Goal:** Telegram becomes the input/output channel.

- [ ] Implement `Channel` interface (connect, sendMessage, isConnected, ownsJid, disconnect)
- [ ] Build Telegram adapter using `node-telegram-bot-api` (long polling, not webhooks — simpler for dev)
- [ ] Route incoming Telegram messages through the agent loop
- [ ] Send agent responses back to Telegram
- [ ] Store Telegram messages in SQLite
- [ ] Handle bot commands: `/start`, `/status`
- [ ] Basic error handling: retry on Telegram API failures

**Deliverable:** Send message to Telegram bot → get AI response back.

**Key files:** `src/channels/telegram.ts`, `src/channels/registry.ts`

### Milestone 5: Orchestrator + Queue
**Goal:** Handle concurrent messages properly with a polling loop and queue.

- [ ] Build the main orchestrator polling loop (replaces CLI as primary entrypoint)
- [ ] Implement GroupQueue with per-group FIFO ordering
- [ ] Configurable `MAX_CONCURRENT_CONTAINERS` (default: 2)
- [ ] Retry failed jobs with exponential backoff (max 5 retries)
- [ ] Graceful handling of messages arriving faster than containers process
- [ ] Implement idle timeout and graceful shutdown (SIGTERM/SIGINT)
- [ ] Crash recovery: re-enqueue unprocessed messages on startup

**Deliverable:** Bot handles multiple simultaneous messages without race conditions. Survives restarts.

**Key files:** `src/index.ts`, `src/group-queue.ts`

### Milestone 6: IPC System
**Goal:** Containers can request actions from the host (send messages, schedule tasks).

- [ ] Implement filesystem-based IPC polling on host
- [ ] Define IPC operations: `message` (send text to a chat)
- [ ] Authorization: validate every IPC request before executing
- [ ] Mount IPC directory into containers
- [ ] Agent can proactively send messages via IPC
- [ ] Error handling: move failed IPC files to errors directory

**Deliverable:** Agent inside container can trigger host-side actions (e.g., send a Telegram message to a different chat).

**Key files:** `src/ipc.ts`

### Milestone 7: Scheduled Tasks
**Goal:** Recurring jobs that invoke the agent and send results.

- [ ] Add `scheduled_tasks` and `task_run_logs` tables to SQLite
- [ ] Implement task scheduler: poll every 60s for due tasks
- [ ] Support cron expressions (via `cron-parser`), intervals, and one-shot
- [ ] Drift prevention for interval tasks
- [ ] Tasks enqueue into GroupQueue
- [ ] Agent can create/pause/resume/cancel tasks via IPC
- [ ] Task results forwarded to target chat
- [ ] Example: daily morning briefing task

**Deliverable:** Set up a cron task → agent runs on schedule → sends result to Telegram.

**Key files:** `src/task-scheduler.ts`

### Milestone 8: Multi-Group Isolation
**Goal:** Full per-group isolation — each conversation is sandboxed.

Each Telegram chat becomes its own group with isolated memory:
```
Global (shared):     SOUL.md, TOOLS.md
                        │
        ┌───────────────┼───────────────┐
        │               │               │
  groups/dm-you/   groups/family/   groups/work/
   MEMORY.md        MEMORY.md       MEMORY.md
   CONTEXT.md       CONTEXT.md      CONTEXT.md
```

- [ ] Each Telegram group/DM gets its own group folder (auto-created on first message)
- [ ] Per-group MEMORY.md, CONTEXT.md, logs, and IPC directories
- [ ] Container mounts scoped to own group folder only
- [ ] Global files (SOUL.md, TOOLS.md) shared across all groups
- [ ] Main group has visibility into all groups (for admin/coordination)
- [ ] Non-main groups cannot access each other's data
- [ ] Trigger patterns: non-main groups require @mention to activate
- [ ] Sender allowlist for access control

**Deliverable:** Multiple Telegram groups each with isolated memory and filesystem. DM the bot privately, add it to a family group — each has separate context.

**Key files:** `src/group-folder.ts` (expanded), `src/mount-security.ts`

---

## Milestone Sequencing Rationale

**Why this order differs from the kickoff doc:**

1. **Milestone 0 (Scaffolding)** is new — we need the Docker image before anything else works.

2. **Milestone 3 (SQLite)** was moved before Telegram because Telegram needs message storage to work properly. You can't meaningfully integrate a messaging channel without persisting messages.

3. **Milestones 5-6 (Queue + IPC)** were split from Telegram. The kickoff doc had "Queue and Concurrency" as milestone 4, but it makes more sense to get Telegram working simply first (direct invoke), then add the queue layer. This gives us a working bot earlier.

4. **Multi-Group was kept last** because it's a refinement of isolation, not a core capability. Everything works with a single group first.

**Each milestone is end-to-end testable:**
- M0: `npm run build` + `docker build`
- M1: CLI → container → response
- M2: CLI remembers across invocations + agent can search the web
- M3: Messages in SQLite, recent history in prompt
- M4: Telegram bot responds
- M5: Concurrent messages handled properly
- M6: Agent sends messages via IPC
- M7: Scheduled task runs and sends results
- M8: Multiple groups isolated

---

## Dependencies (Minimal)

**Host process:**

| Package | Purpose | Milestone |
|---------|---------|-----------|
| `better-sqlite3` | SQLite database | M3 |
| `node-telegram-bot-api` | Telegram integration | M4 |
| `cron-parser` | Cron expression parsing for scheduler | M7 |

**Inside container:**

| Package | Purpose | Milestone |
|---------|---------|-----------|
| `@anthropic-ai/claude-agent-sdk` | Agent runtime | M1 |
| Tavily / Firecrawl SDKs | Web search + content extraction (if needed beyond built-in tools) | M2 |

We keep host and container dependencies separate. TypeScript, tsx, and Docker are dev/build tools.

---

## File Structure (Target)

```
kuchiclaw/
├── CLAUDE.md                    # Project conventions for AI assistants
├── SOUL.md                      # Agent personality/rules (global, ro) (M2)
├── TOOLS.md                     # Agent tool documentation (global, ro) (M2)
├── README.md                    # Project documentation
├── package.json
├── tsconfig.json
├── Dockerfile                   # Agent container image
├── docker-compose.yml
├── src/
│   ├── index.ts                 # Main orchestrator (M5)
│   ├── cli.ts                   # CLI entrypoint (M1)
│   ├── container-runner.ts      # Docker container management (M1)
│   ├── db.ts                    # SQLite schema + queries (M3)
│   ├── group-folder.ts          # Group directory management (M2)
│   ├── group-queue.ts           # Per-group FIFO queue (M5)
│   ├── ipc.ts                   # Filesystem IPC (M6)
│   ├── task-scheduler.ts        # Cron/interval scheduler (M7)
│   ├── config.ts                # Configuration constants (M0)
│   ├── types.ts                 # Shared type definitions (M0)
│   └── channels/
│       ├── telegram.ts          # Telegram adapter (M4)
│       └── registry.ts          # Channel management (M4)
├── container/
│   ├── entrypoint.ts            # Runs inside Docker container (M1)
│   └── package.json             # Container-specific deps
├── groups/
│   └── main/
│       ├── MEMORY.md            # Long-lived curated facts (per-group, rw) (M2)
│       ├── CONTEXT.md           # Session working memory (per-group, rw) (M2)
│       └── logs/
├── data/
│   ├── kuchiclaw.db             # SQLite database (M3)
│   └── ipc/                     # IPC directory (M6)
└── tasks/
    └── todo.md                  # Task tracking
```

---

## Resolved Decisions

1. **SOUL.md scope:** Global (project root). Per-group overrides deferred.
2. **Context compaction:** Phased approach — see Decision 9. Phase 1 (M2): four-file system with MEMORY.md (durable) + CONTEXT.md (scratchpad). Phase 2 (M5): pre-session flush to MEMORY.md. Phase 3 (post-M8): full in-session compaction if needed.
3. **Authentication:** Claude Max via `CLAUDE_CODE_OAUTH_TOKEN`. Passed to containers via stdin.
4. **Container image:** Lean (~300MB). No browser. Web access via Tavily/Firecrawl APIs instead.
5. **Container runtime:** Docker only. No Apple Container abstraction.
6. **Web tools:** Tavily (search) + Firecrawl (extraction) as API-based tools. Evaluate SDK built-in `WebSearch` first.
7. **Tool management:** `TOOLS.md` as a global living file documenting available tools and usage patterns.
8. **Session continuity (B+C):** No session ID resumption. Fresh session each invocation. Continuity via living files (MEMORY.md as primary memory) + recent message history from SQLite in the prompt (lets Claude connect related topics across interleaved conversations).
9. **Behavior Loop:** Agent writes corrections and preferences to MEMORY.md `## Lessons` immediately when user corrects it.

---

## Deployment (Post-M4)

Deployment can happen anytime after Telegram works. The feature milestones (M5-M8) can be developed locally and deployed incrementally.

**Requirements:**
- Docker runtime available on the host
- Persistent storage for SQLite database, group folders, and living files
- Outbound HTTPS for Claude API and Telegram API
- Environment variables for secrets (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`)

**Options to evaluate:**

| Option | Pros | Cons |
|--------|------|------|
| **VPS (DigitalOcean, Hetzner)** | Full control, cheap ($5-12/mo), Docker native, persistent disk | Manual setup, manual updates, you manage uptime |
| **Railway** | Git-push deploys, managed Docker, persistent volumes, simple | Less control, pricing scales with usage, vendor lock-in |
| **AWS (ECS/Fargate)** | Production-grade, autoscaling | Complex setup, overkill for single-user bot, expensive at low scale |
| **Fly.io** | Docker-native, persistent volumes, global edge | Smaller ecosystem, volume management quirks |

**Decision deferred.** The architecture is container-based and provider-agnostic — any host that runs Docker works. Key factors to weigh when deciding:
- Cost (this is a single-user bot, not a SaaS)
- Deployment simplicity (git-push vs SSH + systemd)
- Persistent storage reliability (SQLite + living files need durable disk)

**Secrets management on deployment:**
- Dev (macOS): auto-read from keychain, zero config
- Production: env vars via `.env` file (chmod 600), systemd `EnvironmentFile`, or platform-native secrets (Railway secrets, AWS SSM, etc.)
- Secrets are never mounted into containers — always passed via stdin

---

## Future Enhancements (Post-M8)

These are deferred ideas worth revisiting once the core system is working:

- **Session ID resumption** — Pass Claude Agent SDK session IDs to resume previous conversations. Would reduce token usage (no need to re-inject message history) and give Claude richer context. Requires heuristics for when to resume vs start fresh.
- **Tiered retrieval** — When MEMORY.md gets large, don't dump everything into the prompt. Read section headers first (tier 1), then pull in relevant sections (tier 2). Reduces token waste.
- **Full in-session compaction** — Summarize old messages within a session when approaching context limits. Only needed if sessions regularly hit the context window.
- **Score decay / staleness** — Date-stamp facts in MEMORY.md, periodically review and prune stale entries. Could be a scheduled task.
- **Daily logs** — `memory/YYYY-MM-DD.md` append-only logs alongside MEMORY.md. Auto-rotate, only load today + yesterday. Useful if CONTEXT.md gets too noisy.
- **Deduplication** — Detect and merge near-duplicate facts in MEMORY.md (cosine similarity or LLM-based).
- **Apple Container support** — Native macOS containers for lower overhead on dev machines.
- **WhatsApp channel** — Second messaging adapter using the Channel interface.
