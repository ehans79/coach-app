import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

/**
 * One-time entry point to authorize this app against Edu's Strava account.
 * Gated by INTERNAL_API_TOKEN since the app has no user auth of its own but
 * this endpoint can hijack the Strava connection if left open. Visit
 * `${APP_BASE_URL}/connect/strava?token=<INTERNAL_API_TOKEN>` once after
 * deploying; the resulting refresh token is stored in Postgres and reused
 * automatically from then on.
 */
export async function GET(request: NextRequest) {
  const env = getEnv();
  const token = request.nextUrl.searchParams.get("token");
  if (token !== env.INTERNAL_API_TOKEN) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const authorizeUrl = new URL("https://www.strava.com/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.STRAVA_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", `${env.APP_BASE_URL}/connect/strava/callback`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("approval_prompt", "auto");
  authorizeUrl.searchParams.set("scope", "read,activity:read_all,profile:read_all");
  authorizeUrl.searchParams.set("state", env.INTERNAL_API_TOKEN);

  return NextResponse.redirect(authorizeUrl);
}
