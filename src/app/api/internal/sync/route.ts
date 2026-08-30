import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncRecentActivities } from "@/lib/sync/activities";
import { findUncommentedRunActivityIds, generateCommentaryForActivity } from "@/lib/coaching/commentary";

/**
 * Fallback poll target — hit on an hourly Railway cron schedule (separate
 * from the Sunday regeneration cron) so a missed Strava webhook delivery
 * doesn't leave an activity permanently unsynced or uncommented. Also
 * called by the weekly regeneration job before it assesses the past week.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.INTERNAL_API_TOKEN}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const syncResult = await syncRecentActivities();

  const uncommented = await findUncommentedRunActivityIds();
  let commentsGenerated = 0;
  for (const activityId of uncommented) {
    try {
      await generateCommentaryForActivity(activityId);
      commentsGenerated += 1;
    } catch (err) {
      console.error(`Failed to generate commentary for activity ${activityId}`, err);
    }
  }

  return NextResponse.json({ ...syncResult, commentsGenerated });
}
