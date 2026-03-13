# KuchiClaw

Minimal AI agent framework with Docker container isolation. Inspired by [NanoClaw](https://github.com/qwibitai/nanoclaw).

("Kuchi" — a nickname meaning "tiny one." This is the tiny claw.)

## What is this?

KuchiClaw is a single Node.js process that orchestrates AI agent sessions inside ephemeral Docker containers. Each user message triggers a fresh container with the Claude Agent SDK, isolated filesystem mounts, and injected conversation history. The agent runs, responds, and the container is destroyed.

```
Telegram ──> Orchestrator ──> Per-Group Queue ──> Container Runner ──> Docker
   ^              |                                      |
   |              |                                      v
   |         +----+----+                          +-------------+
   |         | SQLite  |                          |  Container  |
   |         |messages |                          | Claude SDK  |
   |         | tasks   |                          | SOUL.md (ro)|
   |         +---------+                          | TOOLS.md(ro)|
   |                                              | MEMORY (rw) |
   |              IPC Poller <-- JSON files <---- | CONTEXT(rw) |
   |              |                               | skills/ (ro)|
   +--------------+                               +-------------+
```

**Key ideas:**
- Each session runs in an ephemeral Docker container — no long-lived agent processes
- Containers can only see explicitly mounted directories (security boundary)
- Persistent memory via living files: SOUL.md and TOOLS.md (global, read-only) + MEMORY.md and CONTEXT.md (per-group, read-write)
- Filesystem-based IPC for container-to-host communication
- SQLite for message history and scheduled tasks
- Telegram as the primary interface (no web UI)

For the full architecture deep-dive, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Repository Structure

This repo contains the **code and configuration**. The agent's living memory files (`groups/*/MEMORY.md`, `groups/*/CONTEXT.md`) are **not tracked here** — they are created at runtime and backed up to a separate private repo. This separation prevents code deployments from overwriting the agent's evolved memory.

```
kuchiclaw/              (this repo — public, code + config)
  groups/example/       Example living files for reference (tracked)
  groups/main/          Created at runtime (gitignored)

kuchiclaw-memory/       (separate repo — private, agent memory)
  groups/main/          Backed up daily from the VPS
  kuchiclaw-backup.db   SQLite snapshot
```

## Setup

### Prerequisites

- Node.js 20+
- Docker
- A [Claude Max](https://claude.ai) subscription (for OAuth) or an [Anthropic API key](https://console.anthropic.com/)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 1. Clone and install

```bash
git clone https://github.com/jonathanavni/kuchiclaw.git
cd kuchiclaw
npm install
npm run build
docker compose build
```

### 2. Configure secrets

Create a `.env` file at the project root:

```bash
# Required
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
MAIN_CHAT_ID=tg-your-chat-id          # Your Telegram chat ID (send /start to the bot to find it)

# Optional
ANTHROPIC_API_KEY=sk-ant-...           # Fallback if OAuth isn't set up (auto-downgrades to Sonnet)
FASTMAIL_API_TOKEN=...                 # For the email skill
ALLOWED_SENDER_IDS=123456789           # Comma-separated Telegram user IDs (empty = allow all)
```

### 3. Authentication

KuchiClaw supports two auth methods:

**Option A: Claude Max OAuth (recommended)** — Uses your Claude Max subscription. Set up OAuth tokens in `data/oauth.json`:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2026-01-01T00:00:00Z"
}
```

The orchestrator auto-refreshes the access token before it expires. On macOS, you can export tokens from the keychain using `deploy/export-oauth.sh`.

**Option B: API key** — Set `ANTHROPIC_API_KEY` in `.env`. This is pay-per-use and automatically uses Sonnet 4.6 (instead of Opus 4.6) to reduce costs.

### 4. Run

**Telegram bot (primary):**

```bash
npx tsx src/index.ts
```

**CLI (for testing):**

```bash
npx tsx src/cli.ts "What is 2+2?"
npx tsx src/cli.ts --group mygroup "Remember that I like coffee"
npx tsx src/cli.ts --history
```

### 5. Customize the agent

- **[SOUL.md](SOUL.md)** — Edit the agent's personality and behavior rules
- **[TOOLS.md](TOOLS.md)** — Document available tools and skills
- **[HEARTBEAT.md](HEARTBEAT.md)** — Configure scheduled self-maintenance tasks
- **[groups/example/](groups/example/)** — See example MEMORY.md and CONTEXT.md formats

### 6. Deploy to a VPS (optional)

See [ARCHITECTURE.md — Deployment](ARCHITECTURE.md#deployment) for full details. Quick version:

```bash
# On your VPS (Ubuntu 24.04)
bash deploy/setup.sh

# Transfer secrets
scp .env root@your-server:/opt/kuchiclaw/.env
scp data/oauth.json root@your-server:/opt/kuchiclaw/data/oauth.json

# Start
systemctl start kuchiclaw
journalctl -u kuchiclaw -f
```

### 7. Set up backups (optional)

Living files and the SQLite database are backed up daily to a private GitHub repo via a systemd timer. This requires:

1. A private GitHub repo (e.g., `kuchiclaw-memory`)
2. A private GitHub App with `contents: write` permission, installed on that repo
3. The app's private key stored on the VPS at `data/github-app/`

See `skills/backup.sh` and `deploy/kuchiclaw-backup.timer` for implementation details.

## Adding Skills

**Simple skills** (recommended): Drop a script in `skills/`, document it in TOOLS.md. The agent shells out to run it.

```bash
# Example: skills/weather.sh
#!/bin/bash
curl -s "https://wttr.in/$1?format=3"
```

**MCP skills**: Add an entry to `mcp-servers.json`. The SDK auto-discovers tools.

## Tests

```bash
npm test
```

## License

MIT
