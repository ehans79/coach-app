import "dotenv/config";
import { upsertActivitiesSince } from "../src/lib/sync/activities";

/**
 * One-time historical backfill so the regeneration engine has visibility
 * into Edu's training history (the Aug 2025 shin issue/recovery block and
 * the Aug 2025-Jun 2026 structured training block), not just what's synced
 * incrementally from here on. Run once after the first Strava connect:
 *
 *   npm run strava:backfill -- 2025-06-01
 *
 * Defaults to 2025-06-01 (a little before the shin issue) if no date given.
 */
async function main() {
  const sinceArg = process.argv[2] ?? "2025-06-01";
  const sinceDate = new Date(sinceArg);
  if (Number.isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid date: ${sinceArg}. Expected YYYY-MM-DD.`);
  }
  const afterEpochSeconds = Math.floor(sinceDate.getTime() / 1000);

  console.log(`Backfilling activities since ${sinceDate.toISOString().slice(0, 10)}...`);
  const count = await upsertActivitiesSince(afterEpochSeconds);
  console.log(`Synced ${count} activities.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
