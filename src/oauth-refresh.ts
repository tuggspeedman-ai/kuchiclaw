// OAuth token auto-refresh for Claude Max.
// Reads/writes data/oauth.json with accessToken, refreshToken, expiresAt.
// Refreshes on demand when token is within 5 minutes of expiry.
// Returns null on failure — caller falls back to ANTHROPIC_API_KEY or keychain.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

const OAUTH_PATH = path.join(DATA_DIR, "oauth.json");

// Refresh 5 minutes before expiry to avoid mid-request failures
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers";

interface OAuthData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms since epoch
}

/** Cached in memory to avoid re-reading file on every call */
let cached: OAuthData | null = null;

function loadFromDisk(): OAuthData | null {
  try {
    if (!fs.existsSync(OAUTH_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(OAUTH_PATH, "utf-8"));
    if (!raw.accessToken || !raw.refreshToken || !raw.expiresAt) return null;
    return raw as OAuthData;
  } catch {
    return null;
  }
}

function saveToDisk(data: OAuthData): void {
  fs.mkdirSync(path.dirname(OAUTH_PATH), { recursive: true });
  fs.writeFileSync(OAUTH_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

async function refreshToken(refreshToken: string): Promise<OAuthData | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        scope: SCOPES,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error(`[OAuth] Refresh failed: ${res.status} ${res.statusText} — ${body}`);
      return null;
    }

    const body = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? refreshToken, // may rotate
      expiresAt: Date.now() + body.expires_in * 1000,
    };
  } catch (err) {
    console.error(`[OAuth] Refresh error: ${err}`);
    return null;
  }
}

/**
 * Get a valid OAuth access token, refreshing if needed.
 * Returns null if no oauth.json exists or refresh fails.
 */
export async function getOAuthToken(): Promise<string | null> {
  if (!cached) cached = loadFromDisk();
  if (!cached) return null;

  // Token still valid — return it
  if (Date.now() < cached.expiresAt - REFRESH_BUFFER_MS) {
    return cached.accessToken;
  }

  // Needs refresh
  console.log("[OAuth] Token expiring soon, refreshing...");
  const refreshed = await refreshToken(cached.refreshToken);
  if (!refreshed) {
    cached = null;
    return null;
  }

  cached = refreshed;
  saveToDisk(refreshed);
  console.log("[OAuth] Token refreshed, expires at", new Date(refreshed.expiresAt).toISOString());
  return refreshed.accessToken;
}
