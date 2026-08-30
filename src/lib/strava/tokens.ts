import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { stravaAuth } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import type { StravaTokenResponse } from "./types";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const REFRESH_BUFFER_SECONDS = 5 * 60;

async function requestToken(body: Record<string, string>): Promise<StravaTokenResponse> {
  const env = getEnv();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token request failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function persistToken(token: StravaTokenResponse): Promise<void> {
  await db
    .insert(stravaAuth)
    .values({
      id: 1,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(token.expires_at * 1000),
      scope: token.scope ?? "",
    })
    .onConflictDoUpdate({
      target: stravaAuth.id,
      set: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
        updatedAt: new Date(),
      },
    });
}

/**
 * One-time exchange of an OAuth authorization code for the initial
 * access/refresh token pair. Called from the /connect/strava/callback route.
 */
export async function exchangeAuthorizationCode(code: string): Promise<void> {
  const token = await requestToken({ code, grant_type: "authorization_code" });
  await persistToken(token);
}

/**
 * Returns a currently-valid access token, refreshing against Strava first if
 * the stored one is expired or about to expire. This is the only function
 * the rest of the app should call to get a token — no route should read
 * stravaAuth.accessToken directly.
 */
export async function getValidAccessToken(): Promise<string> {
  const [row] = await db.select().from(stravaAuth).where(eq(stravaAuth.id, 1)).limit(1);
  if (!row) {
    throw new Error(
      "No Strava connection found — visit /connect/strava (with the INTERNAL_API_TOKEN) to authorize once."
    );
  }

  const expiresInSeconds = (row.expiresAt.getTime() - Date.now()) / 1000;
  if (expiresInSeconds > REFRESH_BUFFER_SECONDS) {
    return row.accessToken;
  }

  const token = await requestToken({
    refresh_token: row.refreshToken,
    grant_type: "refresh_token",
  });
  await persistToken(token);
  return token.access_token;
}
