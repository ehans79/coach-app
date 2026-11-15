import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { startFreshBlock } from "../src/lib/coaching/freshBlock";
import { DEFAULT_FRESH_BLOCK_SETTING, parseAvoidList, type TrainingSetting } from "../src/lib/coaching/setting";

/**
 * Starts a fresh training block from recent Strava history — the same thing the
 * "Build a fresh block" button on /settings does, for when a terminal is closer
 * to hand, and with a --dry-run that the button doesn't have.
 *
 *   npm run plan:fresh-block -- --dry-run            # generate and print, write nothing
 *   npm run plan:fresh-block                         # write it as the new active plan
 *   npm run plan:fresh-block -- --outdoor --bodyweight --avoid "Burpee, Pull-up"
 *
 * Defaults to treadmill running, gym strength with every exercise explained,
 * and no bench press (DEFAULT_FRESH_BLOCK_SETTING). Reads whatever activities
 * are already synced: after a hold, resume and backfill first, or use the
 * button, which does both.
 */
function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const avoid = flagValue("--avoid");
  const setting: TrainingSetting = {
    running: args.has("--outdoor") ? "outdoor" : DEFAULT_FRESH_BLOCK_SETTING.running,
    strength: args.has("--bodyweight") ? "bodyweight" : DEFAULT_FRESH_BLOCK_SETTING.strength,
    avoidExercises: avoid !== undefined ? parseAvoidList(avoid) : DEFAULT_FRESH_BLOCK_SETTING.avoidExercises,
    explainExercises: !args.has("--no-explain"),
  };
  const todayStr = flagValue("--today") ?? new Date().toISOString().slice(0, 10);

  console.log(`Building a fresh block as of ${todayStr}${dryRun ? " (dry run — nothing will be written)" : ""}`);
  console.log("Setting:", JSON.stringify(setting));

  const result = await startFreshBlock({ todayStr, setting, dryRun });

  console.log(`\nWeek 1 starts ${result.weekStartDate} — ${result.week.focus}`);
  console.log(`Starting point: ${result.guardrails.startingPoint}`);
  for (const note of result.guardrails.notes) console.log(`  · ${note}`);
  console.log(`\nVerdict: ${result.weekVerdict}`);
  console.log(`Rationale: ${result.rationale}`);
  if (result.warnings.length > 0) console.log("Warnings:", result.warnings);

  for (const day of result.week.days) {
    for (const w of day.workouts) {
      if (w.sport === "rest") continue;
      const size = [
        w.distanceMeters ? `${(w.distanceMeters / 1000).toFixed(1)}km` : null,
        w.durationMinutes ? `${w.durationMinutes}min` : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`\n── ${day.dayOfWeek} ${day.date} · ${w.sport} · ${w.name}${size ? ` (${size})` : ""}`);
      if (w.strength) {
        for (const section of w.strength.sections) {
          console.log(`  ${section.label}${section.rounds ? ` (${section.rounds} rounds)` : ""}`);
          for (const ex of section.exercises) {
            const load = ex.sets ? `${ex.sets}x${ex.reps}` : ex.reps;
            const rest = ex.restBetweenSetsSeconds ? `, ${ex.restBetweenSetsSeconds}s rest` : "";
            console.log(`    - ${ex.exerciseName} — ${load}${rest}`);
            if (ex.howTo) console.log(`        ${ex.howTo}`);
          }
        }
      } else if (w.humanReadable) {
        console.log(w.humanReadable.replace(/^/gm, "  "));
      }
    }
  }

  console.log(
    dryRun
      ? "\n--dry-run: nothing written."
      : `\nInserted plan version ${result.version} (${result.planId}) as the active plan.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
