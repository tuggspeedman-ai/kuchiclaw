
# KuchiClaw — Project Kickoff

("Kuchi" — a nickname meaning "tiny one." This is the tiny claw.)

## What This Is

KuchiClaw is a minimal AI agent framework I'm building from scratch for learning and personal use. It's inspired by NanoClaw ([https://github.com/qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)), which itself is a lightweight alternative to OpenClaw ( https://openclaw.ai/ ). The goal is to build the smallest version of this architecture that I fully understand.

This is both a learning project and a real tool I intend to use for personal automation.

## Why I'm Building This

1. **Learn the Claude Agent SDK** by using it in a real project, not just tutorials. I want hands-on experience with how agent sessions work, how tool use flows, and how to manage context across invocations.
2. **Understand OpenClaw's architecture** by building a simpler version of it. OpenClaw has 434K lines across 3,680 files — too much to internalize. NanoClaw distills the same concepts into ~3,900 lines across 15 files. KuchiClaw should be even smaller, focused only on what I need.
3. **Build portfolio credibility** as an AI Builder and product thinker. This project will be published on my GitHub and personal website. Code quality, clear documentation, and thoughtful architectural decisions matter — this isn't throwaway code.
4. **Actually use it** for personal automation use cases, running securely with my Claude Max subscription.

## OpenClaw and NanoClaw — Context

KuchiClaw is a tiny, from-scratch implementation inspired by two existing projects. You don't need to memorize their codebases, but understanding what they are helps frame what we're building.

**OpenClaw** ([https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)) is the big one — a 196k-star, 434K-line personal AI assistant framework supporting 14+ messaging channels, voice, browser control, companion apps, multi-agent routing, and a skills ecosystem. It's powerful but far too large to understand fully. Its security model relies on application-level permission checks. If you need to understand specific OpenClaw architectural patterns or features during development, go read the relevant parts of the repo or its docs at [https://docs.openclaw.ai](https://docs.openclaw.ai).

**NanoClaw** ([https://github.com/qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)) is the direct inspiration for KuchiClaw. This is the main reference and inspiration for this project. It distills the core OpenClaw concepts into ~3,900 lines across 15 source files. The key difference is its security model: OS-level container isolation (Docker or Apple Container) instead of application-level checks. Each agent session runs in its own container with an isolated filesystem. If you need to understand specific implementation details during development, go read the NanoClaw source — it's small enough to read in one sitting.

## Reference Architecture

NanoClaw's architecture is the reference. The key ideas we should consider:

- **Single Node.js process** as orchestrator — no microservices, no message brokers
- **Container isolation** — each agent session runs in its own Docker container with an isolated filesystem. The agent can only see directories explicitly mounted into the container
- **Filesystem-based IPC** — containers communicate with the host by writing JSON files to a mounted directory. The host polls, validates, executes, and cleans up
- **Per-context persistent memory** — each conversation context gets its own markdown file (similar to CLAUDE.md) that persists across sessions and accumulates context over time
- **SQLite for state** — messages, sessions, groups, scheduled tasks
- **Queue with concurrency control** — per-group FIFO ordering, configurable concurrent container limit, retry with exponential backoff

Some of NanoClaw's key source files for reference:

- `index.ts` — Orchestrator: polling loop, message processing, agent invocation
- `container-runner.ts` — Spawns containers with isolated mounts, streams output
- `group-queue.ts` — Per-group FIFO queue with concurrency limits and retry
- `ipc.ts` — Processes container IPC requests with authorization checks
- `db.ts` — SQLite schema and queries
- `task-scheduler.ts` — Cron, interval, and one-shot scheduled tasks

## Technical Constraints

- **Runtime:** Node.js + TypeScript
- **Container runtime:** Docker (may explore Apple Container on macOS later, but Docker first for portability)
- **AI provider:** Anthropic Claude via the Claude Agent SDK
- **Database:** SQLite
- **Deployment targets:** macOS locally for development, DigitalOcean VPS (Ubuntu) for production
- **Messaging:** Telegram first (I already have a bot set up from my OpenClaw installation). I'd probably want WhatsApp later.
- **Keep it minimal:** I want to understand every line of code. If something can be removed without breaking core functionality, remove it. Fewer dependencies is always better.

## Your First Task

Before writing any code, I want you to propose a project plan. Here's how:

1. **Research the reference projects.** Read the NanoClaw source code ([https://github.com/qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)) — it's only 15 files. Skim the OpenClaw docs ([https://docs.openclaw.ai](https://docs.openclaw.ai)) for architectural patterns and concepts. Understand how both projects approach messaging, container isolation, IPC, scheduling, and memory.
2. '/Users/jonathanavni/Documents/Coding/AI Learning Vault/OpenClaw/dabit3-you-couldve-invented-openclaw.md' and '/Users/jonathanavni/Documents/Coding/AI Learning Vault/OpenClaw/dabit3-pi-agent-stack-powering-openclaw.md' files have some high level context on OpenClaw architecture 
3. **Propose a project plan** with milestones, where each milestone results in a working system I can test end-to-end. Explain your reasoning for the sequencing. The rough milestones below are my initial thinking, but override them freely based on what you learn from the source code.
4. **Wait for my feedback** on the plan before writing any code.

## Rough Milestones (Starting Proposal)

These are my initial thoughts on how to sequence the build. Treat these as a starting point, don't take it as gospel. This is not a spec — edit, reorder, split, or merge these based on what you learn from the actual NanoClaw and OpenClaw architectures, as well as any additional research you decide to do. 

### Milestone 1: Basic Agent Loop

The simplest possible version. A CLI script that:

- Takes a text input from stdin
- Spawns a Docker container with the Claude Agent SDK
- Passes the input to Claude inside the container
- Gets a response back via the filesystem IPC pattern (JSON files in a mounted directory)
- Prints the response

No messaging apps, no queue, no scheduler. Just proving container isolation + IPC works.

### Milestone 2: Persistent Context (Living Files)

Add a per-context markdown file ( e.g. `CONTEXT.md`) that:

- Gets mounted into the container as read/write
- Claude can read at the start of each session
- Claude can append notes/memories to at the end of each session
- Persists across invocations

This is the "Living Files" concept — AI-accessible context that accumulates over time. Note that OpenClaw uses multiple markdown files for long-living memory and context ( HEARTBEAT.md, AGENTS.md, MEMORY.md. SOUL.md, TOOLS.md) - so I defer to you here to propose an approach that makes sense for us. 

### Milestone 3: Telegram Integration

Add Telegram as the input/output channel:

- Poll for messages from a Telegram bot
- Route messages through the agent loop from Milestone 1
- Send responses back to Telegram
- Store message history in SQLite

### Milestone 4: Queue and Concurrency

Add the GroupQueue pattern:

- Per-group FIFO ordering
- Configurable max concurrent containers (default: 2)
- Retry failed jobs with exponential backoff
- Graceful handling of messages arriving faster than containers can process

### Milestone 5: Scheduled Tasks

Add a task scheduler:

- Cron-style recurring jobs
- Jobs invoke the agent loop and send results to Telegram
- Example use case: daily morning briefing, weekly summary

### Milestone 6: Multi-Group Isolation

Full per-group isolation:

- Each Telegram group/conversation gets its own container, filesystem, and CONTEXT.md
- Groups cannot access each other's data
- Separate SQLite tables or namespacing per group

### Remember - these are rough milestones just to start the discussion

Use them as a starting point for initial context. I expect you to iterate, edit and flesh all this out as you get deeper knowledge on the OpenClaw and NanoClaw architecture. 

## Security Principles

These are some initial security design principles. While we can consider being flexible on some of this for specific use cases, this is how I'm thinking about this directionally:

- **Containers are the security boundary.** Agents run in Docker containers and can only access explicitly mounted directories. No ambient access to the host filesystem.
- **Read-only by default.** Mount things read-only unless write access is specifically needed. The CONTEXT.md file is one of the few exceptions.
- **No personal account access.** The agent never gets credentials for personal email, social media, or banking. Dedicated service accounts only.
- **IPC authorization.** The host validates every IPC request from a container before executing it. Containers cannot make arbitrary host-side calls.
- **Minimal network access.** Containers should only be able to reach the APIs they need (Anthropic API, and later Telegram API). No open outbound access.
- **Last mile always manual.** For any action with real-world consequences (sending messages to humans, making purchases, modifying important files), require manual confirmation.

## Code Quality Standards

Since this is a portfolio project:

- Clean, readable TypeScript with meaningful variable names
- Comments explaining _why_, not _what_
- Each source file should have a clear, single responsibility
- No premature abstraction — start concrete, refactor only when patterns emerge
- README.md that explains the project clearly for someone discovering it on GitHub
- Architecture diagram in the README

## What I Don't Want

- Complexity for its own sake
- Features I won't use
- Abstraction layers that obscure what's happening
- Dependencies I haven't evaluated
- Auto-generated boilerplate
- A dashboard or web UI (Telegram is the interface so this is not needed)

## Task Management

- Before implementation, write a plan to `tasks/todo.md` with checkable items
- Check in with me before starting implementation
- Mark items complete as you go
- Add a review section to `tasks/todo.md` when done

## Workflow Rules

- Enter plan mode for any non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan — don't keep pushing
- Never mark a task complete without proving it works (run tests, spin up a container, check the output)
- After correcting a mistake, update CLAUDE.md so you don't make it again

## How to Work With Me

I want to understand what's being built, not just receive working code. When implementing:

- Explain architectural decisions before writing code
- When there's a meaningful choice to make, present the options and tradeoffs
- Keep files small and focused — if a file is growing past ~200 lines, consider splitting
- After each milestone, pause for me to review and test before moving on
- If something in this document seems wrong or could be improved, say so
- We will keep 

## Your First Task

As described above, before writing any code, I want you to propose a detailed project plan. Here's how:

1. **Research the reference projects.** Read the NanoClaw source code ([https://github.com/qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)) — it's only 15 files. Skim the OpenClaw docs ([https://docs.openclaw.ai](https://docs.openclaw.ai)) for architectural patterns and concepts. Understand how both projects approach messaging, container isolation, IPC, scheduling, and memory.
2. '/Users/jonathanavni/Documents/Coding/AI Learning Vault/OpenClaw/dabit3-you-couldve-invented-openclaw.md' and '/Users/jonathanavni/Documents/Coding/AI Learning Vault/OpenClaw/dabit3-pi-agent-stack-powering-openclaw.md' files have some high level context on OpenClaw architecture 
3. **Propose a project plan** with milestones, where each milestone results in a working system I can test end-to-end. Explain your reasoning for the sequencing. The rough milestones below are my initial thinking, but override them freely based on what you learn from the source code.
4. The plan should include initializing a CLAUDE.md file to reflect this document as well as a project-plan.md file with the detailed phases and milestones. We will use the project-plan.md file in order to document our decisions and track our progress. 
5. **Wait for my feedback** on the plan before writing any code.
