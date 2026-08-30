import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planWorkouts, plans } from "@/lib/db/schema";

/**
 * The athlete's local calendar date for an activity — see
 * findMatchingPlanWorkout's doc comment for why toISOString().slice(0,10)
 * is correct here (Strava's start_date_local is local wall-clock time
 * encoded with a "Z" suffix).
 */
export function localDateOf(startDateLocal: Date): string {
  return startDateLocal.toISOString().slice(0, 10);
}

/**
 * Finds the prescribed session for a run: the plan_workouts row on the
 * currently active plan whose date matches the activity's local start date.
 * `startDateLocal` must be the Date parsed from Strava's start_date_local
 * (which encodes local wall-clock time with a "Z" suffix) so the UTC date
 * component read back out is actually the athlete's local calendar date.
 * Returns null for an unplanned/extra run.
 */
export async function findMatchingPlanWorkout(startDateLocal: Date) {
  const dateStr = localDateOf(startDateLocal);
  const [row] = await db
    .select({ workout: planWorkouts })
    .from(planWorkouts)
    .innerJoin(plans, eq(planWorkouts.planId, plans.id))
    .where(
      and(eq(plans.isActive, true), eq(planWorkouts.date, dateStr), eq(planWorkouts.sport, "run"))
    )
    .limit(1);
  return row?.workout ?? null;
}
