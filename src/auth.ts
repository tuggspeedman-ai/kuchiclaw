// Authentication helpers — shared by cli.ts and index.ts.
// Priority: OAuth auto-refresh > ANTHROPIC_API_KEY env var > macOS keychain.

import { execSync } from "node:child_process";
import { getOAuthToken } from "./oauth-refresh.js";

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

export interface AuthResult {
  secrets: Record<string, string>;
  /** True when using ANTHROPIC_API_KEY (paid) instead of OAuth (free with Claude Max) */
  isApiKeyFallback: boolean;
}

/** Resolve auth secrets. Priority: oauth.json (auto-refresh) > env vars > macOS keychain. */
export async function getSecrets(): Promise<AuthResult> {
  const secrets: Record<string, string> = {};
  let isApiKeyFallback = false;

  // 1. Try OAuth auto-refresh (data/oauth.json)
  const oauthToken = await getOAuthToken();
  if (oauthToken) {
    secrets.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
  }
  // 2. Env var overrides (API key — paid fallback, use cheaper model)
  else if (process.env.ANTHROPIC_API_KEY) {
    secrets.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    isApiKeyFallback = true;
    console.warn("[Auth] OAuth unavailable, falling back to ANTHROPIC_API_KEY (Sonnet)");
  }
  // 3. Env var fallback for OAuth token
  else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    secrets.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  // 4. macOS keychain (local dev)
  else {
    const keychainToken = readTokenFromKeychain();
    if (keychainToken) {
      secrets.CLAUDE_CODE_OAUTH_TOKEN = keychainToken;
    } else {
      console.error(
        "Error: No auth token found.\n" +
        "Provide data/oauth.json (OAuth refresh), set ANTHROPIC_API_KEY or\n" +
        "CLAUDE_CODE_OAUTH_TOKEN in your environment, or log in to Claude Code."
      );
      process.exit(1);
    }
  }

  // Optional skill secrets — passed through to container environment
  if (process.env.FASTMAIL_API_TOKEN) {
    secrets.FASTMAIL_API_TOKEN = process.env.FASTMAIL_API_TOKEN;
  }

  return { secrets, isApiKeyFallback };
}
