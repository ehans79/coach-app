import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { activities } from "../src/lib/db/schema";
import { computeMetricsForActivity, backfillPowerScalarsFromCache } from "../src/lib/metrics/pipeline";
import { computeDailyRollup } from "../src/lib/metrics/rollup";
import { rebuildBestEfforts } from "../src/lib/metrics/bestEfforts";
import { rebuildBestPowerEfforts } from "../src/lib/metrics/bestPowerEfforts";
import { reconcileVdotIntoZones, redetectQualifyingEfforts } from "../src/lib/metrics/qualifyingEfforts";
import { refitCriticalSpeed } from "../src/lib/metrics/criticalSpeed";
import { refitCriticalPower } from "../src/lib/metrics/criticalPower";

// Delay between Strava calls (each activity costs up to 2: a streams refetch if
// the cache predates grade_smooth/altitude/moving, plus a laps fetch, which is
// never cached). Strava's default app quota is ~100 req/15min — 800ms keeps a
// ~95-activity backfill comfortably under that even after a prior run already
// used part of the window.
const DELAY_MS = 800;
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One-time historical backfill so activity_metrics/daily_load cover the full
 * training history, not just what's computed incrementally from here on. Also
 * re-run this after correcting athlete_constants (e.g. once a real threshold
 * pace/HR retest is available) — IF/rTSS/hrTSS/runType all shift with the
 * constants, and nothing recomputes historical rows automatically.
 *
 * IMPORTANT — this is the ONE path that rewrites history. Normal operation applies a
 * new VDOT-derived threshold pace prospectively only: each activity_metrics row keeps
 * the constants_id it was computed under, so past rTSS/IF values stay as they were
 * measured. Running this re-derives every historical row against whatever constants are
 * current NOW, which is a deliberate re-baseline (useful right after a first real VDOT
 * lands and the seed's provisional threshold is known to have been wrong) and not
 * something to run casually.
 *
 *   npm run backfill:metrics
 */
async function main() {
  console.log("Backfilling activities.workout_type from cached raw_summary (no Strava calls)...");
  const workoutTypeResult = await db.execute(
    sql`UPDATE ${activities} SET workout_type = (raw_summary->>'workout_type')::int
        WHERE raw_summary ? 'workout_type' AND workout_type IS NULL`
  );
  console.log(`Backfilled workout_type on ${workoutTypeResult.rowCount ?? 0} activities.`);

  const runRows = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.sportType, "Run"))
    .orderBy(activities.startDate);

  console.log(`Computing metrics for ${runRows.length} historical run activities...`);
  let succeeded = 0;
  for (const { id } of runRows) {
    try {
      await computeMetricsForActivity(id);
      succeeded += 1;
    } catch (err) {
      console.error(`Failed to compute metrics for activity ${id}`, err);
    }
    await sleep(DELAY_MS);
  }
  console.log(`Computed metrics for ${succeeded}/${runRows.length} activities.`);

  console.log("Rolling up daily training load...");
  const rollup = await computeDailyRollup();
  console.log(`Rolled up ${rollup.daysComputed} days.`);

  // The pipeline's incremental best-effort update can only ever RAISE a best, so after a
  // re-baseline it would leave stale rows standing from activities that no longer hold
  // the record. Full rescan instead — it reads only cached streams, no Strava calls.
  console.log("Rebuilding the mean-maximal best-efforts curve...");
  const rebuilt = await rebuildBestEfforts();
  console.log(`Filled ${rebuilt.durationsFilled} durations from ${rebuilt.activitiesScanned} runs.`);

  // Cheap safety net: fills power columns on any row whose metrics predate power
  // support, straight from cached streams. Redundant right after the full recompute
  // above, but makes this script correct even when that loop partly failed.
  const powerScalars = await backfillPowerScalarsFromCache();
  console.log(`Power scalars filled on ${powerScalars.updated}/${powerScalars.scanned} metric rows.`);

  console.log("Rebuilding the mean-maximal power curve...");
  const rebuiltPower = await rebuildBestPowerEfforts();
  console.log(`Filled ${rebuiltPower.durationsFilled} durations from ${rebuiltPower.activitiesScanned} runs with power.`);

  // Re-runs the race/time-trial detector over the whole history from cached streams.
  // Redundant with the per-activity pass above on a full backfill, but it's the path
  // that re-applies tuned detection thresholds without touching Strava.
  console.log("Re-detecting race-quality efforts...");
  const detected = await redetectQualifyingEfforts();
  console.log(`${detected.qualified} of ${detected.scanned} runs qualify for a VDOT estimate.`);

  // Once, at the end — the per-activity loop above only DETECTS qualifying efforts;
  // promoting the best one into the active threshold/zones is a whole-history decision.
  const vdot = await reconcileVdotIntoZones();
  console.log(vdot.applied ? `VDOT/zones updated: ${vdot.reason}` : `VDOT/zones unchanged: ${vdot.reason}`);

  const csFit = await refitCriticalSpeed();
  console.log(
    csFit.fit
      ? `Critical Speed: ${csFit.fit.criticalSpeedMps.toFixed(3)} m/s (${Math.round(csFit.fit.criticalSpeedPaceSecPerKm)}s/km), D' ${csFit.fit.dPrimeMeters.toFixed(0)}m, r²=${csFit.fit.rSquared.toFixed(3)}.`
      : `Critical Speed not fit: ${csFit.reason}`
  );

  const cpFit = await refitCriticalPower();
  console.log(
    cpFit.fit
      ? `Critical Power: ${cpFit.fit.criticalPowerWatts.toFixed(1)}W, W' ${(cpFit.fit.wPrimeJoules / 1000).toFixed(1)}kJ, r²=${cpFit.fit.rSquared.toFixed(3)}.`
      : `Critical Power not fit: ${cpFit.reason}`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
