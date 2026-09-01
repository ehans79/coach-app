import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans, planWorkouts, planWorkoutExercises } from "@/lib/db/schema";
import { assessWeek, type WeekAssessment } from "./weeklyAssessment";
import { computeGuardrails, type Guardrails } from "./guardrails";
import { flattenPlanWorkouts, type PlanDocument, type PlanWeekJson, type PlanDayJson } from "./plan";
import { generateStructured, COACHING_MODEL } from "@/lib/llm/anthropic";
import { getAllExercises, ExerciseCatalog } from "./exerciseCatalog";
import {
  buildStrengthWorkoutSchema,
  resolveStrengthWorkout,
  formatStrengthWorkoutText,
  flattenStrengthExercises,
} from "./strengthSchema";

const COACHING_REFERENCE = `Progressive overload / ramp rate (by athlete state): true beginner 5-10%/week; some experience (1-2yr) 10%/week; strong foundation returning from a break 10-15%/week; recent high fitness/no break: maintain or small build. Time off from injury needs more caution than time off from life circumstances.
Loading pattern: 3 weeks building + 1 recovery week (30-40% volume cut) is standard. Recovery weeks: no Zone 4+ work, 40-50% of a normal week's volume.
Long-run progression: never increase by more than ~2-3km/week.
Weekly structure: no same-sport back-to-back hard days; 48hr between quality sessions; easy day after long runs; consistent weekly schedule.
Intensity distribution (polarized): 75-80% of weekly volume easy (Zone 1-2), 5-10% moderate (Zone 3 — deliberately minimized), 15-20% hard (Zone 4-5).`;

const STRENGTH_REFERENCE = `Foundation-level session structure (beginner, base phase — the athlete's current level): 2-3 sets x 12-15 reps, bodyweight only — add light dumbbells/kettlebell only once bodyweight feels easy across all sets. Every session includes core work (a plank/anti-rotation move, a hip-hinge or bridge move, a single-leg balance move). Include run-specific focus exercises across sessions: lunges, Romanian deadlifts (bodyweight/light-load for a beginner), calf raises, single-leg work (single-leg balance, step-ups).
Structure (four sections, always in this order): Warm-up (2-4 light mobility/activation moves) → Circuit (4-6 exercises done for 2-3 rounds) → Core finisher (2-3 exercises) → Cool-down (2-4 static stretches). Every exercise in every section — including warm-up and cool-down — must be an exact Garmin Connect exercise name from the list below; never invent one or describe one in free text instead of picking a list entry.
One exercise per step, never a combined choice: Garmin Connect lists close variants as separate, distinct exercises (e.g. "Push-up" and "Knee Push-up" are two different list entries) — commit to one specific exercise, never something like "Push-ups (knee or full)" that tries to name two entries at once. If you want an easier or harder version for this athlete, pick that specific variant's own list entry.
Rest scheme (this athlete has no rest-timer habit yet, so be explicit and a little conservative): 30-45s between sets for most circuit bodyweight/light-dumbbell exercises, 45-60s for anything loaded or hinge-pattern (deadlift variations, weighted step-ups); core-finisher holds usually need less, 20-30s; between circuit rounds, 45-90s depending on how taxing the round was. Warm-up/cool-down exercises don't need rest fields.
Progression across weeks: keep the same movement patterns — progress by adding a round, moving toward the top of the rep range, or tightening form/tempo (and only trim rest time once the athlete is clearly recovering fully within it). Only add a light external load once bodyweight feels genuinely easy across all sets; never jump straight to heavier weights as the first progression.`;

function findWeekContainingDate(weeks: PlanWeekJson[], dateStr: string): PlanWeekJson | undefined {
  return weeks.find((w) => w.startDate <= dateStr && dateStr <= w.endDate);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeekName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** Built per-call from the full Garmin exercise name reference table (its
 * enum of valid exercise names reflects whatever's imported in the DB right
 * now), rather than as a module-level constant. */
function buildWeekResponseSchema(exerciseNames: string[]) {
  const workoutSchema = z
    .object({
      sport: z.string().describe('e.g. "run", "strength", "rest", "bike".'),
      type: z.string().optional(),
      name: z.string(),
      description: z.string().optional().describe("Ignored for strength workouts — see the strength field instead."),
      durationMinutes: z.number().optional(),
      distanceMeters: z.number().optional().describe("Meters. Omit for non-distance sports."),
      primaryZone: z.string().optional().describe('e.g. "Zone 1-2 (HR <156bpm)" or "N/A (strength)".'),
      humanReadable: z
        .string()
        .optional()
        .describe("Athlete-facing instructions. Ignored for strength workouts — see the strength field instead."),
      strength: z
        .optional(buildStrengthWorkoutSchema(exerciseNames))
        .describe('Required when sport is "strength"; omit entirely for every other sport.'),
    })
    // A plain .optional() can't express "required conditional on a sibling
    // field" — this closes the gap so a "strength" workout can't slip
    // through with no structured exercise data (falling back to free text).
    .refine((w) => (w.sport === "strength" ? w.strength !== undefined : w.strength === undefined), {
      message: 'strength must be set if and only if sport is "strength"',
      path: ["strength"],
    });

  const daysSchema = z.object(
    Object.fromEntries(DAY_NAMES.map((day) => [day, z.array(workoutSchema).min(1)])) as Record<
      (typeof DAY_NAMES)[number],
      z.ZodArray<typeof workoutSchema>
    >
  );

  return z.object({
    focus: z.string().describe("One-line summary of this week's training focus."),
    targetHours: z.number().optional().describe("Estimated total training hours."),
    days: daysSchema,
    rationale: z
      .string()
      .describe(
        "2-4 sentences explaining WHY this week looks the way it does, referencing specific data from last week — shown on the dashboard."
      ),
    weekVerdict: z
      .string()
      .describe(
        'One short line (under 12 words) summing up how LAST week went, e.g. "Solid week — back on track after last week\'s dip." Headlines the weekly email debrief.'
      ),
  });
}

type WeekResponseSchema = ReturnType<typeof buildWeekResponseSchema>;
type LlmWeekResponse = z.infer<WeekResponseSchema>;
type LlmWorkout = LlmWeekResponse["days"][(typeof DAY_NAMES)[number]][number];

function buildPrompt(params: {
  plan: PlanDocument;
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  phase: PlanDocument["phases"][number];
  assessment: WeekAssessment;
  guardrails: Guardrails;
  referenceWeek: PlanWeekJson | undefined;
}): string {
  return `Athlete assessment (from the original plan): ${JSON.stringify(params.plan.assessment)}
Current HR/pace zones: ${JSON.stringify(params.plan.zones)}
Current phase: ${JSON.stringify(params.phase)}

How last week (${params.assessment.weekStartDate} to ${params.assessment.weekEndDate}) actually went:
${JSON.stringify(params.assessment, null, 2)}

Hard guardrails computed for the upcoming week (do not exceed these):
${JSON.stringify(params.guardrails, null, 2)}

The upcoming week is week ${params.weekNumber} (${params.weekStartDate} to ${params.weekEndDate}), days ${DAY_NAMES.join(", ")}.
${
  params.referenceWeek
    ? `For loose reference, here is what this week originally looked like in the hand-built plan (before this trend-based regeneration) — deviate from it as needed to satisfy the guardrails and the actual assessment above, but keep the same weekly rhythm (which days are runs/strength/rest) unless the assessment gives a clear reason to change it:\n${JSON.stringify(params.referenceWeek, null, 2)}`
    : "There is no pre-built reference for this week — continue the same weekly rhythm as recent weeks (3 runs/week, 2 strength sessions/week, rest days between)."
}

A rest day is a workout entry with sport "rest". Every one of the 7 days must have at least one workout entry (use a rest-day entry for days with nothing planned). Distances in meters, metric only.`;
}

function buildSystemPrompt(catalog: ExerciseCatalog): string {
  return `You are Edu's personal running coach, regenerating next week's training plan based on how last week actually went — not blindly incrementing a template. You reason the way a real coach reviewing a training log would: reward consistency and clean zone discipline with progression, and hold back or adjust when the data shows drift, missed sessions, or overreaching signals.

Coaching reference rules to apply:
${COACHING_REFERENCE}

Strength/gym-day reference — use this as a library of exercises and progression logic (not a template to copy verbatim every week), the same way you use the coaching reference above for run days:
${STRENGTH_REFERENCE}

Garmin Connect exercise names — Edu hand-enters each planned strength session into Garmin Connect's manual workout builder himself, so every exercise in every strength workout's "strength" field MUST be one of these exact names, verbatim (this is the complete list from Garmin Connect's own exercise picker — not a curated subset):
${catalog.describe()}

You will be given the athlete's assessment/constraints, current zones, the current training phase, a detailed report of how last week went, and a set of hard guardrails already computed by the app (max volume change, recovery-week status, max long-run increase) — treat the guardrails as non-negotiable caps, not suggestions. Your job is to fill in the specific sessions within those caps and explain the reasoning in the rationale field, in the athlete's own coach's voice — the kind of thing that would appear on a dashboard under "why did my plan change this week."

Every strength/gym-type workout must get the same level of concrete detail as a run workout, via its structured "strength" field (never a generic placeholder like "Beginner Full-Body Strength, 35 minutes" with no exercises) — set "description"/"humanReadable" for every other sport, but leave them out for strength workouts, since the app renders those from the structured data instead.

Output metric units only (km/m, min:sec/km, °C) — never imperial.`;
}

function totalRunDistanceMeters(days: LlmWeekResponse["days"]): number {
  return Object.values(days)
    .flat()
    .filter((w) => w.sport === "run")
    .reduce((sum, w) => sum + (w.distanceMeters ?? 0), 0);
}

/** Clamps the LLM's proposed week to the guardrails' hard bounds — never trust generated output unchecked. */
function clampToGuardrails(
  llmWeek: LlmWeekResponse,
  guardrails: Guardrails
): { week: LlmWeekResponse; warnings: string[] } {
  const warnings: string[] = [];
  const totalKm = totalRunDistanceMeters(llmWeek.days) / 1000;
  const { min, max } = guardrails.targetVolumeKmRange;

  if (totalKm > max * 1.05) {
    const scale = max / totalKm;
    warnings.push(
      `LLM proposed ${totalKm.toFixed(1)}km run volume, above the guardrail max of ${max.toFixed(1)}km — scaled all run distances by ${(scale * 100).toFixed(0)}%.`
    );
    for (const workouts of Object.values(llmWeek.days)) {
      for (const w of workouts) {
        if (w.sport === "run" && w.distanceMeters) {
          w.distanceMeters = Math.round(w.distanceMeters * scale);
        }
      }
    }
  } else if (totalKm < min * 0.5 && min > 0 && !guardrails.isRecoveryWeek) {
    warnings.push(
      `LLM proposed only ${totalKm.toFixed(1)}km run volume, well under the guardrail floor of ${min.toFixed(1)}km — left as-is (could reflect a deliberately cautious week; verify manually).`
    );
  }

  if (guardrails.targetLongRunKmRange) {
    const runWorkouts = Object.values(llmWeek.days)
      .flat()
      .filter((w) => w.sport === "run" && w.distanceMeters);
    const longest = runWorkouts.reduce(
      (max, w) => (w.distanceMeters! > (max?.distanceMeters ?? 0) ? w : max),
      undefined as LlmWorkout | undefined
    );
    if (longest?.distanceMeters) {
      const longestKm = longest.distanceMeters / 1000;
      const capKm = guardrails.targetLongRunKmRange.max;
      if (longestKm > capKm * 1.05) {
        warnings.push(
          `Proposed long run ${longestKm.toFixed(1)}km exceeded the ${capKm.toFixed(1)}km guardrail cap — clamped.`
        );
        longest.distanceMeters = Math.round(capKm * 1000);
      }
    }
  }

  return { week: llmWeek, warnings };
}

export interface RegenerationResult {
  planId: string;
  version: number;
  rationale: string;
  weekVerdict: string;
  guardrails: Guardrails;
  warnings: string[];
  assessment: WeekAssessment;
  newWeek: PlanWeekJson;
}

/**
 * Thrown when `todayStr` falls before the active plan's first week even
 * starts — e.g. the Sunday-evening cron firing once before a plan's Monday
 * start date. Expected and self-resolving (the very next cron run will find
 * a matching week), unlike a genuine mid-plan gap — callers should treat it
 * as a no-op skip, not a failure.
 */
export class PlanNotStartedYetError extends Error {
  constructor(dateStr: string, planStartDate: string) {
    super(`Active plan doesn't start until ${planStartDate} — nothing to regenerate yet for ${dateStr}.`);
    this.name = "PlanNotStartedYetError";
  }
}

/**
 * Regenerates the plan for the week following the one that just ended.
 * `todayStr` should be the date the job runs on (a Sunday) — the "just
 * ended" week is the one containing that date.
 */
export async function regeneratePlanForNextWeek(todayStr: string): Promise<RegenerationResult> {
  const [activePlan] = await db.select().from(plans).where(eq(plans.isActive, true)).limit(1);
  if (!activePlan) throw new Error("No active plan found");

  const planJson = activePlan.planJson as PlanDocument;
  const justEndedWeek = findWeekContainingDate(planJson.weeks, todayStr);
  if (!justEndedWeek) {
    const firstWeek = planJson.weeks[0];
    if (firstWeek && todayStr < firstWeek.startDate) {
      throw new PlanNotStartedYetError(todayStr, firstWeek.startDate);
    }
    throw new Error(`No week in the active plan covers ${todayStr} — plan may need manual attention`);
  }

  const weekNumber = justEndedWeek.weekNumber + 1;
  const weekStartDate = addDays(justEndedWeek.endDate, 1);
  const weekEndDate = addDays(weekStartDate, 6);

  const assessment = await assessWeek(justEndedWeek.startDate, justEndedWeek.endDate);
  const guardrails = computeGuardrails({
    weekNumber,
    previousWeekPlannedVolumeKm: assessment.plannedRunVolumeKm,
    previousWeekActualVolumeKm: assessment.actualRunVolumeKm,
    previousWeekComplianceRatio: assessment.complianceRatio,
    previousWeekHadZoneDrift: assessment.hadZoneDrift,
    previousLongRunKm: assessment.longestRunKm,
  });

  const phase =
    planJson.phases.find((p) => weekNumber >= p.startWeek && weekNumber <= p.endWeek) ??
    planJson.phases[planJson.phases.length - 1];
  const referenceWeek = planJson.weeks.find((w) => w.weekNumber === weekNumber);

  const prompt = buildPrompt({
    plan: planJson,
    weekNumber,
    weekStartDate,
    weekEndDate,
    phase,
    assessment,
    guardrails,
    referenceWeek,
  });

  const allExercises = await getAllExercises();
  const catalog = new ExerciseCatalog(allExercises);

  const llmWeek = await generateStructured({
    system: buildSystemPrompt(catalog),
    prompt,
    schema: buildWeekResponseSchema(catalog.names),
    toolName: "submit_week_plan",
    toolDescription: "Submit the fully-specified training plan for the upcoming week.",
    maxTokens: 8192,
  });
  const { week: clampedWeek, warnings } = clampToGuardrails(llmWeek, guardrails);

  const days: PlanDayJson[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartDate, i);
    const dayName = DAY_NAMES[i];
    const workouts = clampedWeek.days[dayName] ?? [];
    days.push({
      date,
      dayOfWeek: dayOfWeekName(date),
      workouts: workouts.map((w, idx) => {
        const strength = w.sport === "strength" && w.strength ? resolveStrengthWorkout(w.strength, catalog) : undefined;
        const strengthText = strength ? formatStrengthWorkoutText(strength) : undefined;
        return {
          id: `w${weekNumber}-${date}-${w.sport}${idx > 0 ? `-${idx}` : ""}`,
          sport: w.sport,
          type: w.type,
          name: w.name,
          description: strengthText?.description ?? w.description,
          durationMinutes: w.durationMinutes,
          distanceMeters: w.distanceMeters,
          primaryZone: w.primaryZone,
          humanReadable: strengthText?.humanReadable ?? w.humanReadable,
          strength,
          completed: false,
        };
      }),
    });
  }

  const newWeek: PlanWeekJson = {
    weekNumber,
    startDate: weekStartDate,
    endDate: weekEndDate,
    phase: phase.name,
    focus: clampedWeek.focus,
    targetHours: clampedWeek.targetHours,
    isRecoveryWeek: guardrails.isRecoveryWeek,
    days,
  };

  const existingWeekIndex = planJson.weeks.findIndex((w) => w.weekNumber === weekNumber);
  const updatedWeeks = [...planJson.weeks];
  if (existingWeekIndex >= 0) updatedWeeks[existingWeekIndex] = newWeek;
  else updatedWeeks.push(newWeek);

  const updatedPlan: PlanDocument = {
    ...planJson,
    meta: {
      ...planJson.meta,
      updatedAt: new Date().toISOString(),
      totalWeeks: Math.max(planJson.meta.totalWeeks, weekNumber),
      planEndDate: weekEndDate > planJson.meta.planEndDate ? weekEndDate : planJson.meta.planEndDate,
    },
    weeks: updatedWeeks,
  };

  const newVersion = activePlan.version + 1;
  const [insertedPlan] = await db
    .insert(plans)
    .values({
      version: newVersion,
      weekStartDate,
      source: "regeneration",
      rationale: clampedWeek.rationale,
      guardrailsApplied: { ...guardrails, warnings, model: COACHING_MODEL, weekVerdict: clampedWeek.weekVerdict },
      planJson: updatedPlan,
      isActive: true,
    })
    .returning({ id: plans.id });

  await db.update(plans).set({ isActive: false }).where(eq(plans.id, activePlan.id));

  const flattened = flattenPlanWorkouts(updatedPlan);
  const insertedWorkouts = await db
    .insert(planWorkouts)
    .values(
      flattened.map((row) => ({
        planId: insertedPlan.id,
        date: row.date,
        dayOfWeek: row.dayOfWeek,
        workoutKey: row.workoutKey,
        sport: row.sport,
        type: row.type,
        name: row.name,
        description: row.description,
        durationMinutes: row.durationMinutes,
        distanceMeters: row.distanceMeters,
        primaryZone: row.primaryZone,
        humanReadable: row.humanReadable,
        completed: row.completed,
      }))
    )
    .returning({ id: planWorkouts.id, workoutKey: planWorkouts.workoutKey });

  const workoutIdByKey = new Map(insertedWorkouts.map((w) => [w.workoutKey, w.id]));
  const exerciseRows = flattened.flatMap((row) => {
    if (!row.strength) return [];
    const planWorkoutId = workoutIdByKey.get(row.workoutKey);
    if (!planWorkoutId) return []; // shouldn't happen — every flattened row was just inserted above
    return flattenStrengthExercises(row.strength, planWorkoutId, allExercises);
  });
  if (exerciseRows.length > 0) {
    await db.insert(planWorkoutExercises).values(exerciseRows);
  }

  return {
    planId: insertedPlan.id,
    version: newVersion,
    rationale: clampedWeek.rationale,
    weekVerdict: clampedWeek.weekVerdict,
    guardrails,
    warnings,
    assessment,
    newWeek,
  };
}
