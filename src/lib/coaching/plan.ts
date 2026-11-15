// Types + helpers for the plan JSON shape produced by the coach skill that
// hand-built Edu's current plan (see return-to-running-2026-10-11.json at
// the repo root for a full worked example) — the regeneration engine
// produces new versions in this same shape so existing tooling stays
// compatible.
import { LEGACY_SETTING, type TrainingSetting } from "./setting";

// One exercise within a strength session. `exerciseName` is the exact
// display string as it appears in Garmin Connect's manual strength-workout
// exercise picker (see src/lib/db/schema.ts's garmin_exercises table) —
// every value the plan generator can produce here is constrained at
// generation time to that table (src/lib/coaching/exerciseCatalog.ts), not
// free text, so what it suggests is guaranteed typeable verbatim into the
// picker (Edu hand-enters each session into Garmin Connect himself — this
// is purely a naming-match aid, not an API push).
export interface StrengthExerciseJson {
  exerciseName: string;
  sets?: number;
  reps: string; // "12-15" | "8 each side" | "45-60s" — count- or time-based
  restBetweenSetsSeconds?: number;
  /** A beginner's walkthrough — setup, the movement, how to pick a starting
   * weight — written when the plan's setting asks for exercises to be
   * explained (see TrainingSetting.explainExercises). */
  howTo?: string;
}

export interface StrengthSectionJson {
  label: "Warm-up" | "Circuit" | "Core finisher" | "Cool-down";
  rounds?: string; // e.g. "2-3" — only meaningful for a multi-round section like Circuit
  restBetweenRoundsSeconds?: number;
  exercises: StrengthExerciseJson[];
}

export interface StrengthWorkoutJson {
  sections: StrengthSectionJson[];
}

export function planSetting(plan: PlanDocument): TrainingSetting {
  return plan.setting ?? LEGACY_SETTING;
}

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
  /** Structured, catalog-backed exercise breakdown — set for sport
   * "strength" workouts produced by the regeneration engine. `description`/
   * `humanReadable` are still populated (formatted from this data) so
   * existing rendering keeps working; this is the source of truth for the
   * exact Garmin Connect exercise names, for hand-entering the session.
   * Absent on older/seeded plan rows that predate it. */
  strength?: StrengthWorkoutJson;
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

// ---------------------------------------------------------------------------
// External plan skeleton — when the athlete is following a plan built
// somewhere else (currently Runna), that plan owns the *what*: which day
// carries which session, how far it is, and what kind of session it is.
// The regeneration engine is then only allowed to own the *how* — pacing, HR
// targets, the strength sessions Runna doesn't prescribe, and the rationale.
//
// Without this, the Sunday job would happily regenerate its own week from its
// own guardrails and quietly overwrite the plan the athlete is actually
// running, which is exactly the conflict this was added to fix.
// ---------------------------------------------------------------------------

/** One prescribed session from the external plan. Every field here is fixed. */
export interface ExternalSkeletonSession {
  sport: string; // run | strength | rest
  /** e.g. "intervals" | "easy" | "long" | "tempo" | "race" | "strength" */
  type?: string;
  /** The external plan's own name for the session, e.g. "Extended Kms". */
  label: string;
  distanceMeters?: number;
  durationMinutes?: number;
  /** Target zone text, parsed by assessZoneAdherence — must reflect the
   * session's real intent, so a hard interval session isn't later flagged as
   * "easy run drifted into Zone 3". */
  primaryZone?: string;
  /** Set for sessions this app adds on top of the external plan (strength),
   * as opposed to ones the external plan prescribed itself. */
  addedByApp?: boolean;
  note?: string;
}

export interface ExternalSkeletonDay {
  date: string; // YYYY-MM-DD
  sessions: ExternalSkeletonSession[];
}

export interface ExternalSkeletonWeek {
  weekNumber: number;
  startDate: string;
  endDate: string;
  focus?: string;
  isRecoveryWeek?: boolean;
  days: ExternalSkeletonDay[];
}

export interface ExternalPlanSource {
  provider: string; // "Runna"
  planName: string;
  importedAt: string;
  /** Where the structure came from, for provenance on the dashboard. */
  sourceDocument?: string;
  note?: string;
  weeks: ExternalSkeletonWeek[];
}

/** The skeleton week covering `weekStartDate`, if the plan is pinned to an external one. */
export function findSkeletonWeek(
  plan: PlanDocument,
  weekStartDate: string
): ExternalSkeletonWeek | undefined {
  return plan.externalPlan?.weeks.find((w) => w.startDate === weekStartDate);
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
  /** Where this block is trained (treadmill or outdoors, gym or bodyweight)
   * and what must never be prescribed. Absent on plans that predate it, which
   * were all outdoor running + bodyweight strength — read it through
   * planSetting() rather than directly. */
  setting?: TrainingSetting;
  /** Set when the athlete is following an externally-built plan (Runna) and
   * this app is layering coaching on top of it rather than authoring the
   * structure itself. See ExternalPlanSource. */
  externalPlan?: ExternalPlanSource;
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
  /** Carried through so callers (regeneration.ts) can insert the
   * corresponding plan_workout_exercises rows once they have the inserted
   * plan_workouts id — not itself a plan_workouts column. */
  strength: StrengthWorkoutJson | null;
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
          strength: workout.strength ?? null,
        });
      }
    }
  }
  return rows;
}
