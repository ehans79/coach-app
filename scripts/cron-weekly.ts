import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { syncRecentActivities } from "../src/lib/sync/activities";
import { findUncommentedRunActivityIds, generateCommentaryForActivity } from "../src/lib/coaching/commentary";
import { findUnmatchedActivityIds, matchAndMarkCompletion } from "../src/lib/coaching/matching";
import { computeMetricsForActivity, findUnmetricatedRunActivityIds } from "../src/lib/metrics/pipeline";
import { computeDailyRollup } from "../src/lib/metrics/rollup";
import { regeneratePlanForNextWeek, PlanNotStartedYetError } from "../src/lib/coaching/regeneration";
import { sendWeeklyDebrief } from "../src/lib/email/sendWeeklyDebrief";

/**
 * Entrypoint for the Railway `cron-weekly` service — runs Sunday evening.
 * Syncs first (fallback catch-up for anything a webhook missed this week),
 * generates commentary for anything still uncommented, regenerates the plan
 * for the coming week, then emails the debrief — chained here rather than a
 * separate schedule, per the brief.
 */
async function main() {
  console.log("Syncing recent activities...");
  const syncResult = await syncRecentActivities();
  console.log(`Synced ${syncResult.count} activities.`);

  const unmatched = await findUnmatchedActivityIds();
  for (const activityId of unmatched) {
    try {
      await matchAndMarkCompletion(activityId);
    } catch (err) {
      console.error(`Failed to match activity ${activityId} against the plan`, err);
    }
  }

  const unmetricated = await findUnmetricatedRunActivityIds();
  for (const activityId of unmetricated) {
    try {
      await computeMetricsForActivity(activityId);
    } catch (err) {
      console.error(`Failed to compute metrics for activity ${activityId}`, err);
    }
  }

  console.log("Rolling up daily training load...");
  const rollup = await computeDailyRollup();
  console.log(`Rolled up ${rollup.daysComputed} days.`);

  const uncommented = await findUncommentedRunActivityIds();
  for (const activityId of uncommented) {
    try {
      await generateCommentaryForActivity(activityId);
    } catch (err) {
      console.error(`Failed to generate commentary for activity ${activityId}`, err);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Regenerating plan for the week following ${today}...`);
  try {
    const result = await regeneratePlanForNextWeek(today);
    console.log(`Created plan version ${result.version} (${result.planId})`);
    console.log("Rationale:", result.rationale);
    if (result.warnings.length > 0) console.log("Warnings:", result.warnings);

    console.log("Sending weekly debrief email...");
    await sendWeeklyDebrief(result);
    console.log("Sent.");
  } catch (err) {
    if (err instanceof PlanNotStartedYetError) {
      console.log(err.message, "Skipping regeneration and email this cycle.");
    } else {
      throw err;
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
