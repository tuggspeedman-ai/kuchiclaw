#!/usr/bin/env node

// CLI entrypoint for testing the agent loop.
// Usage: echo "What is 2+2?" | npx tsx src/cli.ts
//    or: npx tsx src/cli.ts "What is 2+2?"

import { execSync } from "node:child_process";
import { runContainer } from "./container-runner.js";
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

async function main() {
  // Get prompt from args or stdin
  const argsPrompt = process.argv.slice(2).join(" ");
  const stdinPrompt = await readStdin();
  const prompt = argsPrompt || stdinPrompt;

  if (!prompt) {
    console.error("Usage: echo \"your prompt\" | npx tsx src/cli.ts");
    console.error("   or: npx tsx src/cli.ts \"your prompt\"");
    process.exit(1);
  }

  const secrets = getSecrets();

  const input: ContainerInput = {
    prompt,
    groupFolder: "main",
    secrets,
  };

  console.error(`[KuchiClaw] Sending prompt to container: "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`);

  try {
    const output = await runContainer(input);

    if (output.status === "success") {
      console.log(output.result ?? "(no response)");
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
