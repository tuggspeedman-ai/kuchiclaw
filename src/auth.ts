// Authentication helpers — shared by cli.ts and index.ts.
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
  const secrets: Record<string, string> = {};

  // Claude auth — required
  if (process.env.ANTHROPIC_API_KEY) {
    secrets.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    secrets.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    const keychainToken = readTokenFromKeychain();
    if (keychainToken) {
      secrets.CLAUDE_CODE_OAUTH_TOKEN = keychainToken;
    } else {
      console.error(
        "Error: No auth token found.\n" +
        "Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in your environment,\n" +
        "or log in to Claude Code (the token is read from macOS keychain)."
      );
      process.exit(1);
    }
  }

  // Optional skill secrets — passed through to container environment
  if (process.env.FASTMAIL_API_TOKEN) {
    secrets.FASTMAIL_API_TOKEN = process.env.FASTMAIL_API_TOKEN;
  }

  return secrets;
}
