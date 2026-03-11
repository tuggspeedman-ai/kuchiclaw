#!/usr/bin/env node

// Runs inside the Docker container.
// Reads ContainerInput from stdin, invokes Claude Agent SDK, writes output
// between sentinel markers to stdout.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "node:fs";

const OUTPUT_START = "---KUCHICLAW_OUTPUT_START---";
const OUTPUT_END = "---KUCHICLAW_OUTPUT_END---";

interface ContainerInput {
  prompt: string;
  groupFolder: string;
  secrets: Record<string, string>;
  systemPrompt?: string;
  messageHistory?: string;
}

interface ContainerOutput {
  status: "success" | "error";
  result?: string;
  error?: string;
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
  const memory = readIfExists("/workspace/MEMORY.md");
  const context = readIfExists("/workspace/CONTEXT.md");

  const parts: string[] = [];
  if (soul) parts.push(soul);
  if (tools) parts.push(tools);
  if (memory) parts.push(memory);
  if (context) parts.push(context);

  return parts.join("\n\n---\n\n");
}

// Module-level so the catch handler can access it
let sdkStderr = "";

async function main() {
  const raw = await readStdin();
  const input: ContainerInput = JSON.parse(raw);

  // Set auth token from secrets into environment so the SDK can use it
  if (input.secrets.CLAUDE_CODE_OAUTH_TOKEN) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = input.secrets.CLAUDE_CODE_OAUTH_TOKEN;
  }
  if (input.secrets.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = input.secrets.ANTHROPIC_API_KEY;
  }

  let systemPrompt = input.systemPrompt || buildSystemPrompt();

  // Append message history so the agent sees recent conversation context
  if (input.messageHistory) {
    systemPrompt += "\n\n---\n\n" + input.messageHistory;
  }

  // Run the agent — query() returns an async iterator of SDKMessage
  const session = query({
    prompt: input.prompt,
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      maxTurns: 3,
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
      cwd: "/workspace",
      systemPrompt,
      stderr: (data: string) => { sdkStderr += data; },
    },
  });

  let resultText = "";

  for await (const message of session) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        resultText = message.result;
      } else {
        emit({ status: "error", error: `Agent error: ${JSON.stringify(message)}\nstderr: ${sdkStderr}` });
        return;
      }
    }
  }

  emit({ status: "success", result: resultText });
}

main().catch((err) => {
  emit({ status: "error", error: `${String(err)}\nstderr: ${sdkStderr}` });
  process.exit(1);
});
