import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { syncRecentActivities } from "../src/lib/sync/activities";
import { findUncommentedRunActivityIds, generateCommentaryForActivity } from "../src/lib/coaching/commentary";
import { findUnmatchedActivityIds, matchAndMarkCompletion } from "../src/lib/coaching/matching";
import { computeMetricsForActivity, findUnmetricatedRunActivityIds } from "../src/lib/metrics/pipeline";
import { computeDailyRollup } from "../src/lib/metrics/rollup";
import { reconcileVdotIntoZones } from "../src/lib/metrics/qualifyingEfforts";
import { refitCriticalSpeed } from "../src/lib/metrics/criticalSpeed";
import { refitCriticalPower } from "../src/lib/metrics/criticalPower";
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

  // Catch-up for the hourly sync's own reconciliation — self-healing if a webhook or
  // poll cycle failed midway and left a detected qualifying effort unpromoted.
  const vdot = await reconcileVdotIntoZones();
  console.log(vdot.applied ? `VDOT/zones updated: ${vdot.reason}` : `VDOT/zones unchanged: ${vdot.reason}`);

  // Critical Speed is refit weekly rather than on every sync: one activity rarely moves
  // the mean-maximal curve, and a nightly refit would fill the version history with
  // near-identical fits.
  const csFit = await refitCriticalSpeed();
  console.log(
    csFit.fit
      ? `Critical Speed refit: ${csFit.fit.criticalSpeedMps.toFixed(3)} m/s, D' ${csFit.fit.dPrimeMeters.toFixed(0)}m, r²=${csFit.fit.rSquared.toFixed(3)} over ${csFit.fit.points.length} points.`
      : `Critical Speed not refit: ${csFit.reason}`
  );

  const cpFit = await refitCriticalPower();
  console.log(
    cpFit.fit
      ? `Critical Power refit: ${cpFit.fit.criticalPowerWatts.toFixed(1)}W, W' ${(cpFit.fit.wPrimeJoules / 1000).toFixed(1)}kJ, r²=${cpFit.fit.rSquared.toFixed(3)} over ${cpFit.fit.points.length} points.`
      : `Critical Power not refit: ${cpFit.reason}`
  );

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
