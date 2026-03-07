# KuchiClaw

Minimal AI agent framework with Docker container isolation. Inspired by [NanoClaw](https://github.com/qwibitai/nanoclaw).

## Architecture

```
┌─────────────────────────────────────────┐
│           Host (Node.js)                │
│                                         │
│  Telegram ──► Orchestrator ──► Queue    │
│                    │                    │
│              ┌─────┴─────┐              │
│              │  SQLite DB │              │
│              └───────────┘              │
└──────────────────┬──────────────────────┘
                   │ spawn container
          ┌────────┴────────────┐
          │   Docker Container  │
          │                     │
          │  Claude Agent SDK   │
          │  SOUL.md (ro)       │
          │  TOOLS.md (ro)      │
          │  MEMORY.md (rw)     │
          │  CONTEXT.md (rw)    │
          │  IPC dir (rw)       │
          └─────────────────────┘
```

**Key concepts:**

- **Group** — A persistent conversation context. Each Telegram DM or group chat is its own group, with its own MEMORY.md, CONTEXT.md, and message history. Groups live forever and accumulate memory over time.
- **Session** — A single container invocation to process a message. Container spins up, Claude responds, container dies. Ephemeral by design. Continuity across sessions comes from living files and message history, not from keeping containers alive.

**Key ideas:**
- Each session runs in an ephemeral Docker container — no long-lived processes
- Containers can only see explicitly mounted directories
- Persistent memory via living files: SOUL.md and TOOLS.md (global, read-only) + MEMORY.md and CONTEXT.md (per-group, read-write)
- Filesystem-based IPC for container ↔ host communication
- SQLite for message history and scheduled tasks

## Setup

```bash
npm install
npm run build
docker compose build
```

## Status

**Milestone 0: Project Scaffolding** — Complete

See [project-plan.md](project-plan.md) for the full roadmap.

## License

MIT
