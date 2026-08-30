import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { syncRecentActivities } from "../src/lib/sync/activities";
import { findUncommentedRunActivityIds, generateCommentaryForActivity } from "../src/lib/coaching/commentary";
import { findUnmatchedActivityIds, matchAndMarkCompletion } from "../src/lib/coaching/matching";
import { regeneratePlanForNextWeek } from "../src/lib/coaching/regeneration";

/**
 * Entrypoint for the Railway `cron-weekly` service — runs Sunday evening.
 * Syncs first (fallback catch-up for anything a webhook missed this week),
 * generates commentary for anything still uncommented, then regenerates the
 * plan for the coming week. The weekly email debrief chains on here once
 * that feature is built.
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
  const result = await regeneratePlanForNextWeek(today);
  console.log(`Created plan version ${result.version} (${result.planId})`);
  console.log("Rationale:", result.rationale);
  if (result.warnings.length > 0) console.log("Warnings:", result.warnings);

  // Weekly email debrief hooks in here (Phase 5).

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
