import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { exchangeAuthorizationCode } from "@/lib/strava/tokens";

export async function GET(request: NextRequest) {
  const env = getEnv();
  const params = request.nextUrl.searchParams;

  // `state` round-trips the token we required on the /connect/strava entry
  // point — this is the CSRF check for the flow, Strava's `state` is opaque.
  if (params.get("state") !== env.INTERNAL_API_TOKEN) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const error = params.get("error");
  if (error) {
    return new NextResponse(`Strava authorization was not completed: ${error}`, { status: 400 });
  }

  const code = params.get("code");
  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  await exchangeAuthorizationCode(code);
  return NextResponse.redirect(new URL("/", env.APP_BASE_URL));
}
