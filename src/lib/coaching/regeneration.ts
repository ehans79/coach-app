import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans, planWorkouts, planWorkoutExercises } from "@/lib/db/schema";
import { assessWeek, type WeekAssessment } from "./weeklyAssessment";
import { getCurrentZoneVersion, type CurrentZoneVersion } from "./zones";
import { computeGuardrails, type Guardrails } from "./guardrails";
import {
  flattenPlanWorkouts,
  findSkeletonWeek,
  planSetting,
  type PlanDocument,
  type PlanWeekJson,
  type PlanDayJson,
  type ExternalSkeletonWeek,
  type ExternalSkeletonSession,
} from "./plan";
import { generateStructured, COACHING_MODEL } from "@/lib/llm/anthropic";
import { getAllExercises, ExerciseCatalog, type GarminExercise } from "./exerciseCatalog";
import {
  buildStrengthWorkoutSchema,
  resolveStrengthWorkout,
  formatStrengthWorkoutText,
  flattenStrengthExercises,
} from "./strengthSchema";
import { runningReference, strengthReference, settingLabel, type TrainingSetting } from "./setting";

const COACHING_REFERENCE = `Progressive overload / ramp rate (by athlete state): true beginner 5-10%/week; some experience (1-2yr) 10%/week; strong foundation returning from a break 10-15%/week; recent high fitness/no break: maintain or small build. Time off from injury needs more caution than time off from life circumstances.
Loading pattern: 3 weeks building + 1 recovery week (30-40% volume cut) is standard. Recovery weeks: no Zone 4+ work, 40-50% of a normal week's volume.
Long-run progression: never increase by more than ~2-3km/week.
Weekly structure: no same-sport back-to-back hard days; 48hr between quality sessions; easy day after long runs; consistent weekly schedule.
Intensity distribution (polarized): 75-80% of weekly volume easy (Zone 1-2), 5-10% moderate (Zone 3 — deliberately minimized), 15-20% hard (Zone 4-5).`;

function findWeekContainingDate(weeks: PlanWeekJson[], dateStr: string): PlanWeekJson | undefined {
  return weeks.find((w) => w.startDate <= dateStr && dateStr <= w.endDate);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeekName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** Built per-call from the full Garmin exercise name reference table (its
 * enum of valid exercise names reflects whatever's imported in the DB right
 * now), rather than as a module-level constant. */
export function buildWeekResponseSchema(exerciseNames: string[], setting: TrainingSetting) {
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
        .optional(buildStrengthWorkoutSchema(exerciseNames, { explain: setting.explainExercises }))
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
export type LlmWeekResponse = z.infer<WeekResponseSchema>;
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
  currentZones: CurrentZoneVersion | null;
  skeletonWeek: ExternalSkeletonWeek | undefined;
  externalProvider: string | undefined;
  lastWeekStrength: string | undefined;
}): string {
  return `Athlete assessment (from the original plan): ${JSON.stringify(params.plan.assessment)}
Current HR/pace zones (live, as of ${params.currentZones?.asOfDate ?? "n/a"} — prescribe against THESE, not any zone table quoted elsewhere): ${JSON.stringify(
    params.currentZones ?? params.plan.zones
  )}
Current phase: ${JSON.stringify(params.phase)}

How last week (${params.assessment.weekStartDate} to ${params.assessment.weekEndDate}) actually went:
${JSON.stringify(params.assessment, null, 2)}

Hard guardrails computed for the upcoming week (do not exceed these):
${JSON.stringify(params.guardrails, null, 2)}

The upcoming week is week ${params.weekNumber} (${params.weekStartDate} to ${params.weekEndDate}), days ${DAY_NAMES.join(", ")}.
${
  params.skeletonWeek
    ? describeSkeletonWeek(params.externalProvider ?? "external", params.skeletonWeek)
    : params.referenceWeek
      ? `For loose reference, here is what this week originally looked like in the hand-built plan (before this trend-based regeneration) — deviate from it as needed to satisfy the guardrails and the actual assessment above, but keep the same weekly rhythm (which days are runs/strength/rest) unless the assessment gives a clear reason to change it:\n${JSON.stringify(params.referenceWeek, null, 2)}`
      : "There is no pre-built reference for this week — continue the same weekly rhythm as recent weeks (3 runs/week, 2 strength sessions/week, rest days between)."
}
${
  params.lastWeekStrength
    ? `\nLast week's strength sessions, for continuity — progress these rather than starting from a new set of exercises:\n${params.lastWeekStrength}\n`
    : ""
}
A rest day is a workout entry with sport "rest". Every one of the 7 days must have at least one workout entry (use a rest-day entry for days with nothing planned). Distances in meters, metric only.`;
}

const REGENERATION_ROLE = `You are Edu's personal running coach, regenerating next week's training plan based on how last week actually went — not blindly incrementing a template. You reason the way a real coach reviewing a training log would: reward consistency and clean zone discipline with progression, and hold back or adjust when the data shows drift, missed sessions, or overreaching signals.`;

const REGENERATION_BRIEF = `You will be given the athlete's assessment/constraints, current zones, the current training phase, a detailed report of how last week went, and a set of hard guardrails already computed by the app (max volume change, recovery-week status, max long-run increase) — treat the guardrails as non-negotiable caps, not suggestions. Your job is to fill in the specific sessions within those caps and explain the reasoning in the rationale field, in the athlete's own coach's voice — the kind of thing that would appear on a dashboard under "why did my plan change this week."`;

/**
 * The system prompt shared by the weekly regeneration and the fresh-block
 * builder. `catalog` must already have the setting's avoided exercises removed
 * — the list printed here is the menu the model picks from.
 */
export function buildSystemPrompt(
  catalog: ExerciseCatalog,
  setting: TrainingSetting,
  voice: { role: string; brief: string } = { role: REGENERATION_ROLE, brief: REGENERATION_BRIEF }
): string {
  return `${voice.role}

Coaching reference rules to apply:
${COACHING_REFERENCE}

Where this block is trained: ${settingLabel(setting)}. This holds for every session you write.
${runningReference(setting)}

Strength/gym-day reference — use this as a library of exercises and progression logic (not a template to copy verbatim every week), the same way you use the coaching reference above for run days:
${strengthReference(setting)}

Garmin Connect exercise names — Edu hand-enters each planned strength session into Garmin Connect's manual workout builder himself, so every exercise in every strength workout's "strength" field MUST be one of these exact names, verbatim (taken from Garmin Connect's own exercise picker):
${catalog.describe()}

${voice.brief}

Every strength/gym-type workout must get the same level of concrete detail as a run workout, via its structured "strength" field (never a generic placeholder like "Beginner Full-Body Strength, 35 minutes" with no exercises) — set "description"/"humanReadable" for every other sport, but leave them out for strength workouts, since the app renders those from the structured data instead.

Output metric units only (km/m, min:sec/km, km/h, °C) — never imperial.`;
}

function totalRunDistanceMeters(days: LlmWeekResponse["days"]): number {
  return Object.values(days)
    .flat()
    .filter((w) => w.sport === "run")
    .reduce((sum, w) => sum + (w.distanceMeters ?? 0), 0);
}

/** Clamps the LLM's proposed week to the guardrails' hard bounds — never trust generated output unchecked. */
export function clampToGuardrails(
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

// ---------------------------------------------------------------------------
// External-plan skeleton enforcement
// ---------------------------------------------------------------------------

function skeletonSessionLine(session: ExternalSkeletonSession): string {
  const bits = [`sport=${session.sport}`];
  if (session.type) bits.push(`type=${session.type}`);
  bits.push(`label="${session.label}"`);
  if (session.distanceMeters) bits.push(`distance=${session.distanceMeters}m`);
  if (session.durationMinutes) bits.push(`duration=${session.durationMinutes}min`);
  if (session.primaryZone) bits.push(`primaryZone="${session.primaryZone}"`);
  if (session.addedByApp) bits.push("(added by this app, not by the external plan)");
  if (session.note) bits.push(`note="${session.note}"`);
  return bits.join(", ");
}

/** Renders the pinned week as an explicit day-by-day contract for the prompt. */
function describeSkeletonWeek(provider: string, week: ExternalSkeletonWeek): string {
  const lines = week.days.map((day) => {
    const dayName = dayOfWeekName(day.date);
    const sessions = day.sessions.map((s) => `    - ${skeletonSessionLine(s)}`).join("\n");
    return `  ${dayName} ${day.date}:\n${sessions}`;
  });
  return `THIS WEEK IS PINNED to the athlete's ${provider} plan${week.focus ? ` — ${week.focus}` : ""}.
The structure below is FIXED and is NOT yours to change. For every day you must emit exactly the sessions listed, in order, with exactly the sport, distance/duration and primaryZone given. Do not add sessions, drop sessions, move them between days, or alter any distance — the app overwrites those fields with these values afterwards regardless, so deviating only produces text that contradicts the prescription the athlete sees.

${lines.join("\n")}

What IS yours to write, and where all your coaching judgement should go:
- the session "name" and the athlete-facing "humanReadable" instructions: warm-up, the structure of the reps, pacing and HR targets, and what to focus on or correct based on how last week actually went;
- the full structured "strength" field for every strength session (the external plan does not prescribe these — they are this app's contribution);
- "focus", "rationale" and "weekVerdict".
Use the guardrails below as context for your COACHING (how hard to push the quality session, how much to emphasise holding the easy runs easy), not as distance caps — the external plan owns periodisation now, so where a guardrail and the pinned structure disagree, the pinned structure wins and you should say so in the rationale if it matters.`;
}

/**
 * Rebuilds the LLM's week so every fixed field comes from the skeleton and only
 * the prose/strength detail comes from the model. Belt-and-braces on top of the
 * prompt: the athlete's actual plan must match what the external app says
 * regardless of what the model returned.
 */
function applySkeleton(
  llmWeek: LlmWeekResponse,
  skeleton: ExternalSkeletonWeek
): { week: LlmWeekResponse; warnings: string[] } {
  const warnings: string[] = [];
  const days = {} as LlmWeekResponse["days"];

  for (const day of skeleton.days) {
    const dayName = dayOfWeekName(day.date) as (typeof DAY_NAMES)[number];
    const proposed = [...(llmWeek.days[dayName] ?? [])];
    const rebuilt: LlmWorkout[] = [];

    for (const session of day.sessions) {
      // Prefer a same-sport proposal so the prose actually describes this session.
      const matchIdx = proposed.findIndex((w) => w.sport === session.sport);
      const match = matchIdx >= 0 ? proposed.splice(matchIdx, 1)[0] : undefined;
      if (!match) {
        warnings.push(
          `Model returned no ${session.sport} session for ${dayName} ${day.date} — inserted the pinned "${session.label}" with no coaching detail.`
        );
      } else if (session.distanceMeters && match.distanceMeters && Math.abs(match.distanceMeters - session.distanceMeters) > 100) {
        warnings.push(
          `Model proposed ${(match.distanceMeters / 1000).toFixed(1)}km for ${dayName}'s "${session.label}" against the pinned ${(session.distanceMeters / 1000).toFixed(1)}km — overwritten with the pinned distance.`
        );
      }

      rebuilt.push({
        ...(match ?? { sport: session.sport, name: session.label }),
        sport: session.sport,
        type: session.type ?? match?.type,
        name: match?.name ?? session.label,
        distanceMeters: session.distanceMeters,
        durationMinutes: session.durationMinutes ?? match?.durationMinutes,
        primaryZone: session.primaryZone ?? match?.primaryZone,
        // A strength session with no structured detail is worse than useless
        // to hand-enter into Garmin, so surface it rather than silently ship it.
        strength: session.sport === "strength" ? match?.strength : undefined,
      } as LlmWorkout);

      if (session.sport === "strength" && !match?.strength) {
        warnings.push(`Strength session on ${dayName} ${day.date} came back without structured exercises.`);
      }
    }

    for (const leftover of proposed) {
      warnings.push(
        `Model proposed an extra ${leftover.sport} session ("${leftover.name}") on ${dayName} ${day.date} that the pinned plan doesn't contain — dropped.`
      );
    }

    days[dayName] = rebuilt;
  }

  return { week: { ...llmWeek, days }, warnings };
}

/** Turns the model's validated week into dated plan days, resolving every strength exercise against the catalog. */
export function materialiseDays(
  weekNumber: number,
  weekStartDate: string,
  week: LlmWeekResponse,
  catalog: ExerciseCatalog
): PlanDayJson[] {
  const days: PlanDayJson[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartDate, i);
    const dayName = DAY_NAMES[i];
    const workouts = week.days[dayName] ?? [];
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
  return days;
}

/**
 * Writes `plan` as the new active version: the plans row, its flattened
 * plan_workouts, and their plan_workout_exercises, then retires
 * `supersedePlanId`. In one transaction, so a failure part-way can't leave two
 * active plans or an active plan with no workouts under it.
 */
export async function persistPlanVersion(params: {
  plan: PlanDocument;
  version: number;
  weekStartDate: string;
  source: (typeof plans.$inferInsert)["source"];
  rationale: string;
  guardrailsApplied: Record<string, unknown>;
  supersedePlanId: string | null;
  allExercises: GarminExercise[];
}): Promise<string> {
  return db.transaction(async (tx) => {
    if (params.supersedePlanId) {
      await tx.update(plans).set({ isActive: false }).where(eq(plans.id, params.supersedePlanId));
    }

    const [insertedPlan] = await tx
      .insert(plans)
      .values({
        version: params.version,
        weekStartDate: params.weekStartDate,
        source: params.source,
        rationale: params.rationale,
        guardrailsApplied: params.guardrailsApplied,
        planJson: params.plan,
        isActive: true,
      })
      .returning({ id: plans.id });

    const flattened = flattenPlanWorkouts(params.plan);
    const insertedWorkouts = await tx
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
      return flattenStrengthExercises(row.strength, planWorkoutId, params.allExercises);
    });
    if (exerciseRows.length > 0) {
      await tx.insert(planWorkoutExercises).values(exerciseRows);
    }

    return insertedPlan.id;
  });
}

/** Last week's strength sessions as text, so the next week progresses them instead of reinventing them. */
function describeStrengthSessions(week: PlanWeekJson): string | undefined {
  const sessions = week.days.flatMap((day) =>
    day.workouts
      .filter((w) => w.sport === "strength" && w.humanReadable)
      .map((w) => `${day.dayOfWeek} — ${w.name}:\n${w.humanReadable}`)
  );
  return sessions.length > 0 ? sessions.join("\n\n") : undefined;
}

/**
 * Output budget for one generated week. A how-to on every main exercise of two
 * gym sessions roughly doubles what the strength half of the response needs,
 * and a week truncated mid-JSON fails validation outright.
 */
export function weekMaxTokens(setting: TrainingSetting): number {
  return setting.explainExercises ? 14_000 : 8192;
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

  const currentZones = await getCurrentZoneVersion();
  // When the athlete is following an externally-built plan, that plan owns the
  // week's structure and this engine only writes the coaching detail on top.
  const skeletonWeek = findSkeletonWeek(planJson, weekStartDate);
  const setting = planSetting(planJson);
  const prompt = buildPrompt({
    plan: planJson,
    weekNumber,
    weekStartDate,
    weekEndDate,
    phase,
    assessment,
    guardrails,
    referenceWeek,
    currentZones,
    skeletonWeek,
    externalProvider: planJson.externalPlan?.provider,
    lastWeekStrength: describeStrengthSessions(justEndedWeek),
  });

  const allExercises = await getAllExercises();
  // Avoided exercises are removed from the menu itself, not just argued against
  // in the prompt — see ExerciseCatalog.without.
  const catalog = new ExerciseCatalog(allExercises).without(setting.avoidExercises);

  const llmWeek = await generateStructured({
    system: buildSystemPrompt(catalog, setting),
    prompt,
    schema: buildWeekResponseSchema(catalog.names, setting),
    toolName: "submit_week_plan",
    toolDescription: "Submit the fully-specified training plan for the upcoming week.",
    maxTokens: weekMaxTokens(setting),
  });
  // Pinned weeks are not clamped: the external plan already periodises volume,
  // and scaling its distances would put the app back in conflict with the plan
  // the athlete is actually running. The guardrail comparison is still recorded
  // as a warning so an unusually big jump is visible rather than silent.
  const { week: clampedWeek, warnings } = skeletonWeek
    ? applySkeleton(llmWeek, skeletonWeek)
    : clampToGuardrails(llmWeek, guardrails);

  if (skeletonWeek) {
    const pinnedKm = totalRunDistanceMeters(clampedWeek.days) / 1000;
    if (pinnedKm > guardrails.targetVolumeKmRange.max * 1.05) {
      warnings.push(
        `Pinned ${planJson.externalPlan?.provider ?? "external"} week is ${pinnedKm.toFixed(1)}km, above the ${guardrails.targetVolumeKmRange.max.toFixed(1)}km this app's guardrails would have allowed — left as prescribed (the external plan owns periodisation), but worth an eye on load.`
      );
    }
  }

  const days = materialiseDays(weekNumber, weekStartDate, clampedWeek, catalog);

  const newWeek: PlanWeekJson = {
    weekNumber,
    startDate: weekStartDate,
    endDate: weekEndDate,
    phase: phase.name,
    focus: skeletonWeek?.focus ?? clampedWeek.focus,
    targetHours: clampedWeek.targetHours,
    isRecoveryWeek: skeletonWeek?.isRecoveryWeek ?? guardrails.isRecoveryWeek,
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
  const planId = await persistPlanVersion({
    plan: updatedPlan,
    version: newVersion,
    weekStartDate,
    source: "regeneration",
    rationale: clampedWeek.rationale,
    guardrailsApplied: {
      ...guardrails,
      warnings,
      model: COACHING_MODEL,
      weekVerdict: clampedWeek.weekVerdict,
      setting,
      pinnedTo: skeletonWeek
        ? {
            provider: planJson.externalPlan?.provider ?? "external",
            planName: planJson.externalPlan?.planName ?? null,
            weekNumber: skeletonWeek.weekNumber,
            advisoryOnly: true, // guardrails did not clamp this week
          }
        : null,
    },
    supersedePlanId: activePlan.id,
    allExercises,
  });

  return {
    planId,
    version: newVersion,
    rationale: clampedWeek.rationale,
    weekVerdict: clampedWeek.weekVerdict,
    guardrails,
    warnings,
    assessment,
    newWeek,
  };
}
