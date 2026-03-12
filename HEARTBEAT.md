# HEARTBEAT.md

Self-maintenance checklist. When running as a heartbeat task, work through applicable checks below. Track what you did last and when in CONTEXT.md under `## Heartbeat State`.

## Check email (every ~4 hours)
Run `node /workspace/skills/fastmail.mjs inbox 5` and alert Jonathan via IPC message if anything looks urgent or interesting. Don't send a message if the inbox is quiet.

## Memory housekeeping (once per day)
Review MEMORY.md for problems:
- Deduplicate entries that say the same thing
- Remove stale or outdated facts
- Tighten verbose entries — every line should earn its place
- Promote anything useful from CONTEXT.md to MEMORY.md before it gets rotated

## Rotate checks
Don't do everything every heartbeat. Check `## Heartbeat State` in CONTEXT.md for last check times and rotate:
- Email: every ~4h
- Memory housekeeping: once daily
- Keep heartbeats fast — if nothing needs attention, finish quickly
