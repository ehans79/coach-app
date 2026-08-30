import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, planWorkouts, plans } from "@/lib/db/schema";

/**
 * The athlete's local calendar date for an activity — see
 * findMatchingPlanWorkout's doc comment for why toISOString().slice(0,10)
 * is correct here (Strava's start_date_local is local wall-clock time
 * encoded with a "Z" suffix).
 */
export function localDateOf(startDateLocal: Date): string {
  return startDateLocal.toISOString().slice(0, 10);
}

export function sportsCompatible(planSport: string, stravaSportType: string): boolean {
  if (planSport === "run") return stravaSportType === "Run";
  if (planSport === "strength") return stravaSportType === "WeightTraining" || stravaSportType === "Workout";
  if (planSport === "bike") return stravaSportType === "Ride";
  return false;
}

/**
 * Finds the prescribed session for a run: the plan_workouts row on the
 * currently active plan whose date matches the activity's local start date.
 * `startDateLocal` must be the Date parsed from Strava's start_date_local
 * (which encodes local wall-clock time with a "Z" suffix) so the UTC date
 * component read back out is actually the athlete's local calendar date.
 * Returns null for an unplanned/extra run.
 */
export async function findMatchingPlanWorkout(startDateLocal: Date, sport: string = "run") {
  const dateStr = localDateOf(startDateLocal);
  const [row] = await db
    .select({ workout: planWorkouts })
    .from(planWorkouts)
    .innerJoin(plans, eq(planWorkouts.planId, plans.id))
    .where(and(eq(plans.isActive, true), eq(planWorkouts.date, dateStr), eq(planWorkouts.sport, sport)))
    .limit(1);
  return row?.workout ?? null;
}

/**
 * Matches a synced activity (any sport) against the active plan by date +
 * sport compatibility, and if found, marks the plan_workouts row completed
 * and links activities.plan_workout_id — this is what powers the "This
 * week" dashboard checklist, independent of whether LLM commentary was
 * generated for that activity (commentary is runs-only; completion
 * tracking covers every sport).
 */
export async function matchAndMarkCompletion(activityId: number): Promise<void> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, activityId)).limit(1);
  if (!activity) return;

  const [activePlan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.isActive, true)).limit(1);
  if (!activePlan) return;

  const dateStr = localDateOf(activity.startDateLocal);
  const candidates = await db
    .select()
    .from(planWorkouts)
    .where(and(eq(planWorkouts.planId, activePlan.id), eq(planWorkouts.date, dateStr)));

  const match = candidates.find((w) => sportsCompatible(w.sport, activity.sportType));
  if (!match) return;

  await db.update(planWorkouts).set({ completed: true }).where(eq(planWorkouts.id, match.id));
  await db.update(activities).set({ planWorkoutId: match.id }).where(eq(activities.id, activityId));
}

// Bounds the fallback-poll catch-up to recent activities, not the entire
// backfilled history.
const UNMATCHED_LOOKBACK_DAYS = 3;

/** Recently-synced activities of any sport with no plan_workout match yet. */
export async function findUnmatchedActivityIds(): Promise<number[]> {
  const since = new Date(Date.now() - UNMATCHED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(isNull(activities.planWorkoutId), gte(activities.startDate, since)));
  return rows.map((r) => r.id);
}
