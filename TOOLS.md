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

## Skills

Scripts in `/workspace/skills/` provide additional capabilities. They are read-only.

### echo (proof of concept)
```bash
bash /workspace/skills/echo.sh "your message"
```

## Workspace

Your workspace is `/workspace`. You can read and write files here.

Key files and directories mounted in your workspace:
- `SOUL.md` — Your personality and behavior rules (read-only)
- `TOOLS.md` — This file (read-only)
- `MEMORY.md` — Your long-term memory (read-write). Update this with durable facts.
- `CONTEXT.md` — Session scratchpad (read-write). Use for working notes.
- `ipc/` — Write JSON files here to trigger host-side actions (see IPC section)
- `skills/` — CLI scripts and tools (read-only, see Skills section)

## Constraints
- No access to files outside `/workspace`
- Sessions are ephemeral — the container is destroyed after each invocation
- Your only persistent storage is MEMORY.md and CONTEXT.md
