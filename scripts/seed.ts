import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true }); // fall back to .env for anything not in .env.local
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db/client";
import { athlete, zoneVersions, athleteConstants, plans, planWorkouts } from "../src/lib/db/schema";
import { flattenPlanWorkouts, type PlanDocument } from "../src/lib/coaching/plan";

// HRmax: user-provided, exact. Resting HR: explicit unmeasured placeholder pending a
// real reading. Threshold pace/VDOT: derived via the Daniels-Gilbert VDOT equations
// from a 35:00 5K (VDOT≈25.6) — PROVISIONAL, that result predates an 8-9 week training
// break and the plan's own notes flag it as stale; re-run scripts/backfill-metrics.ts
// after inserting a corrected row. Threshold HR = 88% HRmax (Pfitzinger's 82-91% band),
// which happens to land exactly on the existing Strava Zone 4 "Threshold" floor (172bpm)
// — a useful cross-check.
const SEED_ATHLETE_CONSTANTS = {
  asOfDate: "2026-09-01",
  source:
    "HRmax user-provided (195bpm). Resting HR explicit placeholder (55bpm, pending a real measurement). " +
    "Threshold pace/VDOT via Daniels-Gilbert from a 35:00 5K (VDOT≈25.6) — PROVISIONAL, predates an " +
    "8-9 week training break, needs a retest. Threshold HR = 88% HRmax (172bpm) per Pfitzinger's 82-91% " +
    "band — cross-checks exactly against the existing Strava Zone 4 'Threshold' floor.",
  hrMax: 195,
  restingHr: 55,
  thresholdHr: 172,
  thresholdPaceSecPerKm: 432, // 7:12/km
  vdot: 25.6,
  isProvisional: true,
  isCurrent: true,
};

// Seeded from the brief's "Athlete seed data" section — not present in the
// plan JSON itself, and unknown until the first Strava profile sync.
const SEED_CURRENT_FOCUS = "Increase my VO2 max to get faster";
const SEED_CURRENT_FOCUS_EXPIRES_AT = "2026-10-31";

async function main() {
  const planPath = join(__dirname, "..", "return-to-running-2026-10-11.json");
  const plan = JSON.parse(readFileSync(planPath, "utf-8")) as PlanDocument;

  const [firstName, ...lastNameParts] = plan.meta.athlete.split(" ");

  console.log("Seeding athlete profile...");
  await db
    .insert(athlete)
    .values({
      id: 1,
      stravaAthleteId: null,
      firstName,
      lastName: lastNameParts.join(" ") || null,
      weightKg: null,
      currentFocus: SEED_CURRENT_FOCUS,
      currentFocusExpiresAt: SEED_CURRENT_FOCUS_EXPIRES_AT,
    })
    .onConflictDoNothing({ target: athlete.id });

  console.log("Seeding zone version...");
  await db.insert(zoneVersions).values({
    asOfDate: plan.meta.createdAt.slice(0, 10),
    source: `${plan.zones.run.hr.source} / ${plan.zones.run.pace.source}`,
    hrZones: plan.zones.run.hr.zones,
    paceZones: plan.zones.run.pace.zones,
    isCurrent: true,
  });

  console.log("Seeding athlete constants...");
  await db.insert(athleteConstants).values(SEED_ATHLETE_CONSTANTS);

  console.log("Seeding plan version 1 (from return-to-running-2026-10-11.json)...");
  const [insertedPlan] = await db
    .insert(plans)
    .values({
      version: 1,
      generatedAt: new Date(plan.meta.createdAt),
      weekStartDate: plan.meta.planStartDate,
      source: "seed",
      rationale: "Hand-built starting plan, imported at project setup.",
      planJson: plan,
      isActive: true,
    })
    .returning({ id: plans.id });

  const workoutRows = flattenPlanWorkouts(plan).map((row) => ({
    ...row,
    planId: insertedPlan.id,
  }));
  await db.insert(planWorkouts).values(workoutRows);

  console.log(`Seeded plan ${insertedPlan.id} with ${workoutRows.length} workouts.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
