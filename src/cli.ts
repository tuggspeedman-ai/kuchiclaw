#!/usr/bin/env node

// CLI entrypoint for testing the agent loop.
// Usage: echo "What is 2+2?" | npx tsx src/cli.ts
//    or: npx tsx src/cli.ts "What is 2+2?"

import { execSync } from "node:child_process";
import { runContainer } from "./container-runner.js";
import { ensureGroupFolder } from "./group-folder.js";
import { insertMessage, getRecentMessages, formatHistory } from "./db.js";
import type { ContainerInput } from "./types.js";

async function readStdin(): Promise<string> {
  // If stdin is a TTY (no piped input), return empty
  if (process.stdin.isTTY) return "";

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

/** Read OAuth token from macOS keychain where Claude Code stores it */
function readTokenFromKeychain(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    const creds = JSON.parse(raw);
    return creds?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function getSecrets(): Record<string, string> {
  // Priority: env vars > keychain
  if (process.env.ANTHROPIC_API_KEY) {
    return { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  }

  const keychainToken = readTokenFromKeychain();
  if (keychainToken) {
    return { CLAUDE_CODE_OAUTH_TOKEN: keychainToken };
  }

  console.error(
    "Error: No auth token found.\n" +
    "Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in your environment,\n" +
    "or log in to Claude Code (the token is read from macOS keychain)."
  );
  process.exit(1);
}

/** Parse CLI flags from argv */
function parseArgs(argv: string[]): { group: string; showHistory: boolean; promptArgs: string[] } {
  const args = argv.slice(2);
  let group = "main";
  let showHistory = false;
  const promptArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--group" && i + 1 < args.length) {
      group = args[++i];
    } else if (args[i] === "--history") {
      showHistory = true;
    } else {
      promptArgs.push(args[i]);
    }
  }

  return { group, showHistory, promptArgs };
}

async function main() {
  const { group, showHistory, promptArgs } = parseArgs(process.argv);

  // --history: display recent conversation and exit
  if (showHistory) {
    const messages = getRecentMessages(group);
    if (messages.length === 0) {
      console.log(`No message history for group "${group}".`);
    } else {
      console.log(formatHistory(messages));
    }
    return;
  }

  // Get prompt from args or stdin
  const argsPrompt = promptArgs.join(" ");
  const stdinPrompt = await readStdin();
  const prompt = argsPrompt || stdinPrompt;

  if (!prompt) {
    console.error("Usage: npx tsx src/cli.ts \"your prompt\"");
    console.error("       npx tsx src/cli.ts --group mygroup \"your prompt\"");
    console.error("       npx tsx src/cli.ts --history [--group mygroup]");
    console.error("       echo \"your prompt\" | npx tsx src/cli.ts");
    process.exit(1);
  }

  const secrets = getSecrets();
  const paths = ensureGroupFolder(group);

  // Load recent history from SQLite for conversational context
  const recentMessages = getRecentMessages(group);
  const messageHistory = formatHistory(recentMessages);

  // Store the user's prompt
  insertMessage(group, "user", prompt);

  const input: ContainerInput = {
    prompt,
    groupFolder: group,
    secrets,
    messageHistory: messageHistory || undefined,
  };

  console.error(`[KuchiClaw] Group: ${group} | Prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`);

  try {
    const output = await runContainer(input, paths);

    if (output.status === "success") {
      const result = output.result ?? "(no response)";
      // Store the agent's response
      insertMessage(group, "assistant", result);
      console.log(result);
    } else {
      console.error(`[KuchiClaw] Agent error: ${output.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[KuchiClaw] Container error: ${err}`);
    process.exit(1);
  }
}

main();
