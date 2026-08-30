// Types + helpers for the plan JSON shape produced by the coach skill that
// hand-built Edu's current plan (see return-to-running-2026-10-11.json at
// the repo root for a full worked example) — the regeneration engine
// produces new versions in this same shape so existing tooling stays
// compatible.

export interface PlanWorkoutJson {
  id: string;
  sport: string; // run | strength | rest | bike | ...
  type?: string;
  name: string;
  description?: string;
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string;
  humanReadable?: string;
  completed?: boolean;
}

export interface PlanDayJson {
  date: string; // YYYY-MM-DD
  dayOfWeek: string;
  workouts: PlanWorkoutJson[];
}

export interface PlanWeekJson {
  weekNumber: number;
  startDate: string;
  endDate: string;
  phase: string;
  focus: string;
  targetHours?: number;
  isRecoveryWeek: boolean;
  days: PlanDayJson[];
}

export interface PlanZoneJson {
  zone: number;
  name: string;
  hrLow?: number;
  hrHigh?: number | null;
  paceMinPerKm?: string;
}

export interface PlanDocument {
  version: string;
  meta: {
    id: string;
    athlete: string;
    event: string;
    eventDate: string;
    planStartDate: string;
    planEndDate: string;
    createdAt: string;
    updatedAt: string;
    totalWeeks: number;
    generatedBy: string;
  };
  preferences: { run: string; firstDayOfWeek: string };
  assessment: {
    foundation: Record<string, unknown>;
    currentForm: Record<string, unknown>;
    strengths: unknown[];
    limiters: unknown[];
    constraints: string[];
  };
  zones: {
    run: {
      hr: { lthr: number | null; source: string; zones: PlanZoneJson[] };
      pace: { source: string; zones: PlanZoneJson[] };
      note?: string;
    };
  };
  phases: Array<{
    name: string;
    startWeek: number;
    endWeek: number;
    focus: string;
    weeklyHoursRange?: { low: number; high: number };
    keyWorkouts?: string[];
    physiologicalGoals?: string[];
  }>;
  weeks: PlanWeekJson[];
}

export interface FlattenedPlanWorkout {
  date: string;
  dayOfWeek: string;
  workoutKey: string;
  sport: string;
  type: string | null;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  distanceMeters: number | null;
  primaryZone: string | null;
  humanReadable: string | null;
  completed: boolean;
}

/** Walks weeks[].days[].workouts[] into flat rows for the plan_workouts table. */
export function flattenPlanWorkouts(plan: PlanDocument): FlattenedPlanWorkout[] {
  const rows: FlattenedPlanWorkout[] = [];
  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (const workout of day.workouts) {
        rows.push({
          date: day.date,
          dayOfWeek: day.dayOfWeek,
          workoutKey: workout.id,
          sport: workout.sport,
          type: workout.type ?? null,
          name: workout.name,
          description: workout.description ?? null,
          durationMinutes: workout.durationMinutes ?? null,
          distanceMeters: workout.distanceMeters ?? null,
          primaryZone: workout.primaryZone ?? null,
          humanReadable: workout.humanReadable ?? null,
          completed: workout.completed ?? false,
        });
      }
    }
  }
  return rows;
}
