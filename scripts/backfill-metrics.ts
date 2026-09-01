import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { activities } from "../src/lib/db/schema";
import { computeMetricsForActivity } from "../src/lib/metrics/pipeline";
import { computeDailyRollup } from "../src/lib/metrics/rollup";

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

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
