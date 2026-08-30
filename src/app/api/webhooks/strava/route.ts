import { NextRequest, NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db/client";
import { activities } from "@/lib/db/schema";
import { syncSingleActivityDetail } from "@/lib/sync/activities";

interface StravaWebhookEvent {
  aspect_type: "create" | "update" | "delete";
  object_type: "activity" | "athlete";
  object_id: number;
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, string>;
}

/**
 * Handshake Strava performs once when the push subscription is created —
 * must echo back hub.challenge, and only if hub.verify_token matches.
 */
export async function GET(request: NextRequest) {
  const env = getEnv();
  const params = request.nextUrl.searchParams;

  const mode = params.get("hub.mode");
  const verifyToken = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && verifyToken === env.STRAVA_VERIFY_TOKEN && challenge) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Strava event delivery. Must ack within a couple seconds or Strava retries
 * — so we respond immediately and do the actual Strava API fetch + (later)
 * commentary generation in `after()`, off the response path.
 */
export async function POST(request: NextRequest) {
  const event = (await request.json()) as StravaWebhookEvent;

  if (event.object_type === "activity") {
    if (event.aspect_type === "delete") {
      after(async () => {
        await db.delete(activities).where(eq(activities.id, event.object_id));
      });
    } else {
      after(async () => {
        try {
          await syncSingleActivityDetail(event.object_id);
          // Per-activity commentary generation hooks in here once that
          // feature is built (Phase 2).
        } catch (err) {
          console.error(`Failed to process Strava webhook event for activity ${event.object_id}`, err);
        }
      });
    }
  }

  // Strava only cares about a 200 — body content is ignored.
  return NextResponse.json({});
}
