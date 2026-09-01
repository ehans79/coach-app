import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncRecentActivities } from "@/lib/sync/activities";
import { findUncommentedRunActivityIds, generateCommentaryForActivity } from "@/lib/coaching/commentary";
import { findUnmatchedActivityIds, matchAndMarkCompletion } from "@/lib/coaching/matching";
import { computeMetricsForActivity, findUnmetricatedRunActivityIds } from "@/lib/metrics/pipeline";
import { computeDailyRollup } from "@/lib/metrics/rollup";
import { reconcileVdotIntoZones } from "@/lib/metrics/qualifyingEfforts";

/**
 * Fallback poll target — hit on an hourly Railway cron schedule (separate
 * from the Sunday regeneration cron) so a missed Strava webhook delivery
 * doesn't leave an activity permanently unsynced, uncommented, or unmatched
 * against the plan. Also called by the weekly regeneration job before it
 * assesses the past week.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.INTERNAL_API_TOKEN}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const syncResult = await syncRecentActivities();

  const unmatched = await findUnmatchedActivityIds();
  for (const activityId of unmatched) {
    try {
      await matchAndMarkCompletion(activityId);
    } catch (err) {
      console.error(`Failed to match activity ${activityId} against the plan`, err);
    }
  }

  const unmetricated = await findUnmetricatedRunActivityIds();
  let metricsComputed = 0;
  for (const activityId of unmetricated) {
    try {
      await computeMetricsForActivity(activityId);
      metricsComputed += 1;
    } catch (err) {
      console.error(`Failed to compute metrics for activity ${activityId}`, err);
    }
  }

  const rollup = await computeDailyRollup();

  // Once per batch, not per activity: promotes the best recent qualifying effort's VDOT
  // into the active threshold pace + Daniels pace zones. A no-op unless a new
  // race-quality effort actually moved the number. Runs BEFORE commentary so a new
  // race's own comment is written against the zones it just produced.
  const vdot = await reconcileVdotIntoZones();

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

  return NextResponse.json({ ...syncResult, matched: unmatched.length, metricsComputed, rollup, vdot, commentsGenerated });
}
