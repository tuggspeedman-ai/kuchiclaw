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

## Workspace

Your workspace is `/workspace`. You can read and write files here.

Key files mounted in your workspace:
- `SOUL.md` — Your personality and behavior rules (read-only)
- `TOOLS.md` — This file (read-only)
- `MEMORY.md` — Your long-term memory (read-write). Update this with durable facts.
- `CONTEXT.md` — Session scratchpad (read-write). Use for working notes.

## Constraints
- No access to files outside `/workspace`
- Sessions are ephemeral — the container is destroyed after each invocation
- Your only persistent storage is MEMORY.md and CONTEXT.md
