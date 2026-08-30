import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans, planWorkouts } from "@/lib/db/schema";
import { assessWeek, type WeekAssessment } from "./weeklyAssessment";
import { computeGuardrails, type Guardrails } from "./guardrails";
import { flattenPlanWorkouts, type PlanDocument, type PlanWeekJson, type PlanDayJson } from "./plan";
import { generateText, COACHING_MODEL } from "@/lib/llm/anthropic";

const COACHING_REFERENCE = `Progressive overload / ramp rate (by athlete state): true beginner 5-10%/week; some experience (1-2yr) 10%/week; strong foundation returning from a break 10-15%/week; recent high fitness/no break: maintain or small build. Time off from injury needs more caution than time off from life circumstances.
Loading pattern: 3 weeks building + 1 recovery week (30-40% volume cut) is standard. Recovery weeks: no Zone 4+ work, 40-50% of a normal week's volume.
Long-run progression: never increase by more than ~2-3km/week.
Weekly structure: no same-sport back-to-back hard days; 48hr between quality sessions; easy day after long runs; consistent weekly schedule.
Intensity distribution (polarized): 75-80% of weekly volume easy (Zone 1-2), 5-10% moderate (Zone 3 — deliberately minimized), 15-20% hard (Zone 4-5).`;

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

interface LlmWorkout {
  sport: string;
  type?: string;
  name: string;
  description?: string;
  durationMinutes?: number;
  distanceMeters?: number;
  primaryZone?: string;
  humanReadable?: string;
}

interface LlmWeekResponse {
  focus: string;
  targetHours?: number;
  days: Record<string, LlmWorkout[]>; // keyed by "Monday".."Sunday"
  rationale: string;
}

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
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return `Athlete assessment (from the original plan): ${JSON.stringify(params.plan.assessment)}
Current HR/pace zones: ${JSON.stringify(params.plan.zones)}
Current phase: ${JSON.stringify(params.phase)}

How last week (${params.assessment.weekStartDate} to ${params.assessment.weekEndDate}) actually went:
${JSON.stringify(params.assessment, null, 2)}

Hard guardrails computed for the upcoming week (do not exceed these):
${JSON.stringify(params.guardrails, null, 2)}

The upcoming week is week ${params.weekNumber} (${params.weekStartDate} to ${params.weekEndDate}), days ${days.join(", ")}.
${
  params.referenceWeek
    ? `For loose reference, here is what this week originally looked like in the hand-built plan (before this trend-based regeneration) — deviate from it as needed to satisfy the guardrails and the actual assessment above, but keep the same weekly rhythm (which days are runs/strength/rest) unless the assessment gives a clear reason to change it:\n${JSON.stringify(params.referenceWeek, null, 2)}`
    : "There is no pre-built reference for this week — continue the same weekly rhythm as recent weeks (3 runs/week, 2 strength sessions/week, rest days between)."
}

Respond with ONLY a JSON object, no prose outside it, no markdown fences, matching exactly this shape:
{
  "focus": "one-line summary of this week's training focus",
  "targetHours": <number, estimated total training hours>,
  "days": {
    "Monday": [{"sport": "...", "type": "...", "name": "...", "description": "...", "durationMinutes": <number|omit>, "distanceMeters": <number|omit for non-distance sports>, "primaryZone": "Zone X-Y (HR <Nbpm)" or "N/A (strength)", "humanReadable": "athlete-facing instructions"}],
    "Tuesday": [...], "Wednesday": [...], "Thursday": [...], "Friday": [...], "Saturday": [...], "Sunday": [...]
  },
  "rationale": "2-4 sentences explaining WHY this week looks the way it does, referencing the specific data from last week (e.g. 'long run held flat since Friday's run ran hot again') — this is shown on the dashboard."
}
A rest day is a workout entry with sport "rest". Every one of the 7 days must have at least one workout entry (use a rest-day entry for days with nothing planned). Distances in meters, metric only.`;
}

const SYSTEM_PROMPT = `You are Edu's personal running coach, regenerating next week's training plan based on how last week actually went — not blindly incrementing a template. You reason the way a real coach reviewing a training log would: reward consistency and clean zone discipline with progression, and hold back or adjust when the data shows drift, missed sessions, or overreaching signals.

Coaching reference rules to apply:
${COACHING_REFERENCE}

You will be given the athlete's assessment/constraints, current zones, the current training phase, a detailed report of how last week went, and a set of hard guardrails already computed by the app (max volume change, recovery-week status, max long-run increase) — treat the guardrails as non-negotiable caps, not suggestions. Your job is to fill in the specific sessions within those caps and explain the reasoning in the rationale field, in the athlete's own coach's voice — the kind of thing that would appear on a dashboard under "why did my plan change this week."

Output metric units only (km/m, min:sec/km, °C) — never imperial.`;

function parseWorkoutsResponse(text: string): LlmWeekResponse {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude's regeneration response contained no JSON object");
  return JSON.parse(jsonMatch[0]);
}

function totalRunDistanceMeters(days: Record<string, LlmWorkout[]>): number {
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
  guardrails: Guardrails;
  warnings: string[];
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

  const responseText = await generateText({ system: SYSTEM_PROMPT, prompt, maxTokens: 4096 });
  const llmWeek = parseWorkoutsResponse(responseText);
  const { week: clampedWeek, warnings } = clampToGuardrails(llmWeek, guardrails);

  const days: PlanDayJson[] = [];
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStartDate, i);
    const dayName = dayNames[i];
    const workouts = clampedWeek.days[dayName] ?? [];
    days.push({
      date,
      dayOfWeek: dayOfWeekName(date),
      workouts: workouts.map((w, idx) => ({
        id: `w${weekNumber}-${date}-${w.sport}${idx > 0 ? `-${idx}` : ""}`,
        sport: w.sport,
        type: w.type,
        name: w.name,
        description: w.description,
        durationMinutes: w.durationMinutes,
        distanceMeters: w.distanceMeters,
        primaryZone: w.primaryZone,
        humanReadable: w.humanReadable,
        completed: false,
      })),
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
      guardrailsApplied: { ...guardrails, warnings, model: COACHING_MODEL },
      planJson: updatedPlan,
      isActive: true,
    })
    .returning({ id: plans.id });

  await db.update(plans).set({ isActive: false }).where(eq(plans.id, activePlan.id));

  const workoutRows = flattenPlanWorkouts(updatedPlan).map((row) => ({ ...row, planId: insertedPlan.id }));
  await db.insert(planWorkouts).values(workoutRows);

  return {
    planId: insertedPlan.id,
    version: newVersion,
    rationale: clampedWeek.rationale,
    guardrails,
    warnings,
  };
}
