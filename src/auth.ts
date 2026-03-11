// Authentication helpers — shared by cli.ts and bot.ts.
// Reads Claude auth tokens from env vars or macOS keychain.

import { execSync } from "node:child_process";

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

/** Resolve auth secrets. Priority: env vars > macOS keychain. Exits on failure. */
export function getSecrets(): Record<string, string> {
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
