#!/usr/bin/env node

// Runs inside the Docker container.
// Reads ContainerInput from stdin, invokes Claude Agent SDK, writes output
// between sentinel markers to stdout.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "node:fs";

const OUTPUT_START = "---KUCHICLAW_OUTPUT_START---";
const OUTPUT_END = "---KUCHICLAW_OUTPUT_END---";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ContainerInput {
  prompt: string;
  groupFolder: string;
  chatId?: string;
  secrets: Record<string, string>;
  refreshToken?: string;
  systemPrompt?: string;
  messageHistory?: string;
  mcpServers?: Record<string, McpServerConfig>;
  model?: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface ContainerOutput {
  status: "success" | "error";
  result?: string;
  error?: string;
  newTokens?: OAuthTokens;
}

function emit(output: ContainerOutput): void {
  console.log(OUTPUT_START);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Read a file if it exists, return empty string otherwise */
function readIfExists(path: string): string {
  if (existsSync(path)) return readFileSync(path, "utf-8");
  return "";
}

/** Build system prompt from mounted living files */
function buildSystemPrompt(): string {
  const soul = readIfExists("/workspace/SOUL.md");
  const tools = readIfExists("/workspace/TOOLS.md");
  const heartbeat = readIfExists("/workspace/HEARTBEAT.md");
  const memory = readIfExists("/workspace/MEMORY.md");
  const context = readIfExists("/workspace/CONTEXT.md");

  const parts: string[] = [];
  if (soul) parts.push(soul);
  if (tools) parts.push(tools);
  if (heartbeat) parts.push(heartbeat);
  if (memory) parts.push(memory);
  if (context) parts.push(context);

  return parts.join("\n\n---\n\n");
}

/** Refresh OAuth token via platform.claude.com.
 *  Called from inside the container because the VPS host is Cloudflare-blocked
 *  from this endpoint, but containers have unrestricted network access. */
async function refreshOAuthToken(rt: string): Promise<OAuthTokens | null> {
  try {
    const res = await fetch("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: rt,
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers",
      }),
    });
    if (!res.ok) return null;
    const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? rt,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
  } catch {
    return null;
  }
}

// Module-level so the catch handler can access it
let sdkStderr = "";

async function main() {
  const raw = await readStdin();
  const input: ContainerInput = JSON.parse(raw);

  // Set secrets into environment — auth tokens for SDK, skill tokens for scripts
  for (const [key, value] of Object.entries(input.secrets)) {
    process.env[key] = value;
  }

  // Refresh the OAuth token before running — the access token in secrets may be stale
  // if the Mac's Claude Code rotated it during an active session. The container can
  // reach platform.claude.com even when the VPS host is blocked by Cloudflare.
  let newTokens: OAuthTokens | undefined;
  if (input.refreshToken) {
    const refreshed = await refreshOAuthToken(input.refreshToken);
    if (refreshed) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = refreshed.accessToken;
      newTokens = refreshed;
    }
    // If refresh fails (e.g. token already rotated by a parallel container),
    // fall through — the access token from secrets may still be valid
  }

  let systemPrompt = input.systemPrompt || buildSystemPrompt();

  // Inject session context so the agent knows its group and chat ID (for IPC)
  const contextParts: string[] = [];
  if (input.groupFolder) contextParts.push(`Group: ${input.groupFolder}`);
  if (input.chatId) contextParts.push(`Chat ID: ${input.chatId}`);
  if (contextParts.length > 0) {
    systemPrompt += "\n\n---\n\n## Session Context\n" + contextParts.join("\n");
  }

  // Append message history so the agent sees recent conversation context
  if (input.messageHistory) {
    systemPrompt += "\n\n---\n\n" + input.messageHistory;
  }

  // Build SDK options.
  // maxTurns is a circuit breaker against runaway loops, not a primary control —
  // set it high enough that normal multi-step skills finish (read docs → run tool
  // → summarize is already ~4 turns), low enough to kill a misbehaving agent.
  const maxTurns = 20;
  const sdkOptions: Record<string, unknown> = {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    persistSession: false,
    maxTurns,
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
    cwd: "/workspace",
    systemPrompt,
    stderr: (data: string) => { sdkStderr += data; },
    ...(input.model ? { model: input.model } : {}),
  };

  // Pass MCP servers to SDK if configured
  if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
    sdkOptions.mcpServers = input.mcpServers;
  }

  // Run the agent — query() returns an async iterator of SDKMessage
  const session = query({
    prompt: input.prompt,
    options: sdkOptions,
  });

  let resultText = "";
  // Track the last text the agent produced so we can fall back to it when the
  // run ends without a clean success result (e.g. error_max_turns after a
  // tool call has already completed the real work).
  let lastAssistantText = "";

  for await (const message of session) {
    const m = message as { type: string; subtype?: string; result?: string; message?: { content?: unknown } };

    if (m.type === "assistant" && m.message?.content && Array.isArray(m.message.content)) {
      const texts = (m.message.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length > 0) lastAssistantText = texts.join("\n");
    }

    if (m.type === "result") {
      if (m.subtype === "success") {
        resultText = m.result ?? "";
      } else if (m.subtype === "error_max_turns") {
        // Turn cap is a safety valve, not a logical failure. The agent may have
        // already finished the real work (e.g. sent an email, created a task)
        // and just run out of budget before summarizing. Return whatever it last
        // said, with a hint that the reply may be incomplete.
        resultText = lastAssistantText
          ? `${lastAssistantText}\n\n_(hit the ${maxTurns}-turn limit — reply may be incomplete)_`
          : `Hit the ${maxTurns}-turn limit before producing a response. The work may have partially completed — check downstream effects (emails, tasks, memory).`;
      } else {
        const detail = m.subtype ?? "unknown";
        if (sdkStderr) console.error(`[entrypoint] SDK stderr on ${detail}: ${sdkStderr}`);
        emit({ status: "error", error: `Agent stopped: ${detail}` });
        return;
      }
    }
  }

  emit({ status: "success", result: resultText, ...(newTokens ? { newTokens } : {}) });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (sdkStderr) console.error(`[entrypoint] SDK stderr: ${sdkStderr}`);
  emit({ status: "error", error: `Container crashed: ${msg}` });
  process.exit(1);
});
