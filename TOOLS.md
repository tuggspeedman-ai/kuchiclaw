# TOOLS.md

Tools available to you inside the container.

## File Tools
- **Read** — Read file contents
- **Write** — Create or overwrite a file
- **Edit** — Replace specific text in a file (preferred over Write for modifications)
- **Glob** — Find files by pattern (e.g., `**/*.md`)
- **Grep** — Search file contents with regex

## Shell
- **Bash** — Run shell commands. You have git available.

## Web
- **WebSearch** — Search the web. Use for current events, facts, or anything you're unsure about.
- **WebFetch** — Fetch and read the contents of a URL.

## IPC (Inter-Process Communication)

You can send messages to any chat by writing a JSON file to `/workspace/ipc/`. The host polls this directory and executes valid requests.

**Send a message:**
```bash
cat > /workspace/ipc/msg-$(date +%s%N).json << 'EOF'
{
  "op": "message",
  "chatId": "<target chat ID>",
  "text": "Hello from the agent!",
  "group": "<your group name>"
}
EOF
```

- Use unique filenames (timestamp-based) to avoid collisions
- The file is deleted after processing; failed requests are moved to `ipc/errors/`
- Your chat ID is provided in the prompt context when available

**Create a scheduled task:**
```bash
cat > /workspace/ipc/task-$(date +%s%N).json << 'EOF'
{
  "op": "task_create",
  "chatId": "<target chat ID>",
  "group": "<your group name>",
  "prompt": "Check my inbox and summarize unread emails",
  "scheduleType": "cron",
  "scheduleValue": "0 8 * * *",
  "label": "morning briefing"
}
EOF
```

Schedule types:
- `cron` — cron expression (e.g., `"0 */6 * * *"` for every 6 hours). Times are UTC.
- `interval` — milliseconds between runs (e.g., `"3600000"` for 1 hour)
- `once` — ISO 8601 timestamp for a one-shot task (e.g., `"2026-03-15T10:00:00Z"`)

**Pause/resume/cancel a task:**
```bash
cat > /workspace/ipc/task-$(date +%s%N).json << 'EOF'
{
  "op": "task_pause",
  "chatId": "<target chat ID>",
  "group": "<your group name>",
  "taskId": 1
}
EOF
```
Replace `task_pause` with `task_resume` or `task_cancel` as needed.

**List scheduled tasks:**
```bash
cat > /workspace/ipc/task-$(date +%s%N).json << 'EOF'
{
  "op": "task_list",
  "chatId": "<target chat ID>",
  "group": "<your group name>"
}
EOF
```

## Skills

Scripts in `/workspace/skills/` provide additional capabilities. They are read-only.

### echo (proof of concept)
```bash
bash /workspace/skills/echo.sh "your message"
```

### fastmail (email)

Send and read email as koochi@fastmail.com.

**Send an email:**
```bash
node /workspace/skills/fastmail.mjs send "recipient@example.com" "Subject line" "Email body text"
```

**List recent inbox emails:**
```bash
node /workspace/skills/fastmail.mjs inbox        # default 10
node /workspace/skills/fastmail.mjs inbox 5      # limit to 5
```
Output shows: unread marker (*), message ID, date, sender, subject.

**Read a specific email:**
```bash
node /workspace/skills/fastmail.mjs read <messageId>
```

**Reply to an email:**
```bash
node /workspace/skills/fastmail.mjs reply <messageId> "Reply body text"
```
Threading headers (In-Reply-To, References) are set automatically.

## Workspace

Your workspace is `/workspace`. You can read and write files here.

Key files and directories mounted in your workspace:
- `SOUL.md` — Your personality and behavior rules (read-only)
- `TOOLS.md` — This file (read-only)
- `HEARTBEAT.md` — Self-maintenance checklist (read-only). Follow this when running as a heartbeat task.
- `MEMORY.md` — Your long-term memory (read-write). Update this with durable facts.
- `CONTEXT.md` — Session scratchpad (read-write). Use for working notes.
- `ipc/` — Write JSON files here to trigger host-side actions (see IPC section)
- `skills/` — CLI scripts and tools (read-only, see Skills section)

## Constraints
- No access to files outside `/workspace`
- Sessions are ephemeral — the container is destroyed after each invocation
- Your only persistent storage is MEMORY.md and CONTEXT.md
