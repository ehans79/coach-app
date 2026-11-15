import { z } from "zod";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, plans } from "@/lib/db/schema";
import { generateStructured, COACHING_MODEL } from "@/lib/llm/anthropic";
import { formatPace } from "@/lib/format";
import { isPaused } from "@/lib/pause";
import { getCurrentZoneVersion } from "./zones";
import { getAllExercises, ExerciseCatalog } from "./exerciseCatalog";
import { localDateOf } from "./matching";
import type { Guardrails } from "./guardrails";
import type { PlanDocument, PlanWeekJson } from "./plan";
import {
  DEFAULT_FRESH_BLOCK_SETTING,
  settingConstraints,
  settingLabel,
  type TrainingSetting,
} from "./setting";
import {
  DAY_NAMES,
  addDays,
  dayOfWeekName,
  buildSystemPrompt,
  buildWeekResponseSchema,
  clampToGuardrails,
  materialiseDays,
  persistPlanVersion,
  weekMaxTokens,
} from "./regeneration";

/**
 * Starts a new training block from what Strava says has actually been
 * happening, rather than continuing the plan that was active before.
 *
 * The Sunday job can only extend a plan: it finds the week containing today
 * and writes the one after it. Coming back from a hold there is no such week —
 * the old block ended months ago — and even if there were, its paces, volumes
 * and setting describe a different athlete in a different season. So this
 * writes week 1 of a fresh plan document, sized from recent history, and the
 * Sunday job takes over from week 2 as usual. The setting chosen here (see
 * setting.ts) travels with the plan, so every later week keeps it.
 */

// ---------------------------------------------------------------------------
// When the block starts
// ---------------------------------------------------------------------------

/**
 * Monday of the current week when today is a Monday or Tuesday, otherwise the
 * following Monday.
 *
 * Week 1 has to be a whole week. The Sunday job sizes week 2 from what week 1
 * actually held, so a block that began on a Thursday with one run in it would
 * have its second week built on a third of a week's volume. Starting on a
 * Tuesday loses nothing — every session still fits in the six days left.
 */
export function blockStartDate(todayStr: string): string {
  const day = new Date(`${todayStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  return daysSinceMonday <= 1 ? addDays(todayStr, -daysSinceMonday) : addDays(todayStr, 7 - daysSinceMonday);
}

// ---------------------------------------------------------------------------
// What Strava says has been happening
// ---------------------------------------------------------------------------

const HISTORY_LOOKBACK_WEEKS = 26;
const HISTORY_WEEKS_REPORTED = 8;
const RECENT_RUNS_REPORTED = 8;

export interface HistoryWeek {
  /** Seven days ending the day before `to` — trailing windows back from today, not calendar weeks. */
  from: string;
  to: string;
  runs: number;
  runKm: number;
  longestRunKm: number;
  treadmillRuns: number;
  gymSessions: number;
  gymMinutes: number;
  otherSessions: number;
}

export interface TrainingHistory {
  asOf: string;
  /** Most recent first. */
  weeks: HistoryWeek[];
  daysSinceLastRun: number | null;
  recentRuns: {
    date: string;
    km: number;
    minutes: number;
    avgPace: string;
    avgHeartrate: number | null;
    treadmill: boolean;
  }[];
  gymSessionsLast8Weeks: number;
  recentGymSessions: { date: string; name: string; minutes: number; avgHeartrate: number | null }[];
  /** Weekly running before the most recent gap, when there is one — what "returning" is measured against. */
  beforeTheGap: { weeklyKm: number; longestRunKm: number } | null;
}

function isTreadmill(rawSummary: unknown): boolean {
  return (rawSummary as { trainer?: boolean } | null)?.trainer === true;
}

function isGym(sportType: string): boolean {
  return sportType === "WeightTraining" || sportType === "Workout";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function daysBetween(fromStr: string, toStr: string): number {
  return Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / 86_400_000);
}

/** Summarises the last 26 weeks of synced activities, as of `todayStr` (inclusive). */
export async function summariseTrainingHistory(todayStr: string): Promise<TrainingHistory> {
  const endExclusive = addDays(todayStr, 1);
  const lookbackStart = addDays(endExclusive, -7 * HISTORY_LOOKBACK_WEEKS);

  // start_date_local stores local wall-clock time with a "Z" suffix (see
  // localDateOf), so local calendar dates compare directly against it.
  const rows = await db
    .select()
    .from(activities)
    .where(
      and(
        gte(activities.startDateLocal, new Date(`${lookbackStart}T00:00:00Z`)),
        lt(activities.startDateLocal, new Date(`${endExclusive}T00:00:00Z`))
      )
    )
    .orderBy(desc(activities.startDateLocal));

  const dated = rows.map((a) => ({ a, date: localDateOf(a.startDateLocal) }));
  const runs = dated.filter(({ a }) => a.sportType === "Run");
  const gym = dated.filter(({ a }) => isGym(a.sportType));

  const windowStats = (from: string, toExclusive: string) => {
    const inWindow = dated.filter(({ date }) => date >= from && date < toExclusive);
    const windowRuns = inWindow.filter(({ a }) => a.sportType === "Run");
    const windowGym = inWindow.filter(({ a }) => isGym(a.sportType));
    const runKms = windowRuns.map(({ a }) => (a.distanceMeters ?? 0) / 1000);
    return {
      runs: windowRuns.length,
      runKm: round1(runKms.reduce((s, k) => s + k, 0)),
      longestRunKm: round1(Math.max(0, ...runKms)),
      treadmillRuns: windowRuns.filter(({ a }) => isTreadmill(a.rawSummary)).length,
      gymSessions: windowGym.length,
      gymMinutes: Math.round(windowGym.reduce((s, { a }) => s + (a.movingTimeSeconds ?? 0), 0) / 60),
      otherSessions: inWindow.length - windowRuns.length - windowGym.length,
    };
  };

  const weeks: HistoryWeek[] = [];
  for (let i = 0; i < HISTORY_WEEKS_REPORTED; i++) {
    const toExclusive = addDays(endExclusive, -7 * i);
    const from = addDays(toExclusive, -7);
    weeks.push({ from, to: addDays(toExclusive, -1), ...windowStats(from, toExclusive) });
  }

  const lastRunDate = runs[0]?.date ?? null;
  const daysSinceLastRun = lastRunDate ? daysBetween(lastRunDate, todayStr) : null;

  // The four weeks that ended with the most recent run. After a long gap this
  // is the level being returned to; with no gap it is just "recently".
  let beforeTheGap: TrainingHistory["beforeTheGap"] = null;
  if (lastRunDate) {
    const toExclusive = addDays(lastRunDate, 1);
    const stats = windowStats(addDays(toExclusive, -28), toExclusive);
    beforeTheGap = { weeklyKm: round1(stats.runKm / 4), longestRunKm: stats.longestRunKm };
  }

  return {
    asOf: todayStr,
    weeks,
    daysSinceLastRun,
    recentRuns: runs.slice(0, RECENT_RUNS_REPORTED).map(({ a, date }) => ({
      date,
      km: round1((a.distanceMeters ?? 0) / 1000),
      minutes: Math.round((a.movingTimeSeconds ?? 0) / 60),
      avgPace:
        a.movingTimeSeconds && a.distanceMeters
          ? formatPace(a.movingTimeSeconds / (a.distanceMeters / 1000))
          : "n/a",
      avgHeartrate: a.averageHeartrate != null ? Math.round(a.averageHeartrate) : null,
      treadmill: isTreadmill(a.rawSummary),
    })),
    gymSessionsLast8Weeks: weeks.reduce((s, w) => s + w.gymSessions, 0),
    recentGymSessions: gym.slice(0, 6).map(({ a, date }) => ({
      date,
      name: a.name,
      minutes: Math.round((a.movingTimeSeconds ?? 0) / 60),
      avgHeartrate: a.averageHeartrate != null ? Math.round(a.averageHeartrate) : null,
    })),
    beforeTheGap,
  };
}

// ---------------------------------------------------------------------------
// How much running week 1 may hold
// ---------------------------------------------------------------------------

// A run in the last fortnight means running never really stopped; week 1 picks
// up at the recent average. Past that it is a return, and the level before the
// gap is scaled down by how long the gap was.
const CONTINUOUS_IF_RUN_WITHIN_DAYS = 14;

// Fraction of pre-gap weekly running to restart at. Deliberately on the
// cautious side of common return-to-running guidance: aerobic fitness holds up
// through a gym block far better than the tendons and bones that take the
// impact do, and Edu's history includes a shin problem (Aug 2025).
const RETURN_FRACTION_BY_GAP_DAYS: [maxGapDays: number, fraction: number][] = [
  [28, 0.7],
  [56, 0.5],
  [84, 0.4],
  [Infinity, 0.3],
];

const MIN_WEEKLY_KM = 5; // three short run/walks — the floor for any week 1
const MIN_LONG_RUN_KM = 2;
const FIRST_EVER_WEEK_KM = 6;
const FIRST_EVER_LONG_RUN_KM = 2.5;

export type StartingPoint = "continuing" | "returning" | "starting";

export interface StartingGuardrails extends Guardrails {
  startingPoint: StartingPoint;
}

/**
 * Week 1's hard caps, from history alone — computed here and enforced on the
 * model's output afterwards, the same way the weekly guardrails are.
 */
export function computeStartingGuardrails(history: TrainingHistory): StartingGuardrails {
  const notes: string[] = [];
  let startingPoint: StartingPoint;
  let maxKm: number;
  let longRunKm: number;

  const last4 = history.weeks.slice(0, 4);
  const recentWeeklyKm = last4.reduce((s, w) => s + w.runKm, 0) / 4;
  const recentLongestKm = Math.max(0, ...last4.map((w) => w.longestRunKm));
  const gap = history.daysSinceLastRun;

  if (gap === null || !history.beforeTheGap) {
    startingPoint = "starting";
    maxKm = FIRST_EVER_WEEK_KM;
    longRunKm = FIRST_EVER_LONG_RUN_KM;
    notes.push(
      `No runs in the last ${HISTORY_LOOKBACK_WEEKS} weeks of synced history — treat week 1 as a first week of running: run/walk, capped at ${FIRST_EVER_WEEK_KM}km.`
    );
  } else if (gap <= CONTINUOUS_IF_RUN_WITHIN_DAYS && recentWeeklyKm > 0) {
    startingPoint = "continuing";
    maxKm = recentWeeklyKm;
    longRunKm = recentLongestKm;
    notes.push(
      `Last run was ${gap} day(s) ago and the last four weeks averaged ${recentWeeklyKm.toFixed(1)}km — week 1 holds that level rather than adding to it, since the block is new.`
    );
  } else {
    startingPoint = "returning";
    const fraction = RETURN_FRACTION_BY_GAP_DAYS.find(([maxGap]) => gap <= maxGap)![1];
    maxKm = history.beforeTheGap.weeklyKm * fraction;
    longRunKm = history.beforeTheGap.longestRunKm * fraction;
    notes.push(
      `No run for ${gap} days. Before that the weekly average was ${history.beforeTheGap.weeklyKm.toFixed(1)}km (longest ${history.beforeTheGap.longestRunKm.toFixed(1)}km) — week 1 restarts at ${Math.round(fraction * 100)}% of that. Gym work keeps general fitness, not the impact tolerance running needs, so the legs are brought back gradually.`
    );
  }

  maxKm = Math.max(MIN_WEEKLY_KM, maxKm);
  longRunKm = Math.max(MIN_LONG_RUN_KM, Math.min(longRunKm, maxKm * 0.45));
  notes.push("Week 1 of a new block: easy running only (Zone 1-2), no Zone 4+ work.");

  return {
    startingPoint,
    isRecoveryWeek: false,
    volumeChangePercent: 0,
    maxLongRunIncreaseKm: 0,
    allowZone4Plus: false,
    targetVolumeKmRange: { min: round1(maxKm * 0.8), max: round1(maxKm) },
    targetLongRunKmRange: { min: round1(longRunKm * 0.8), max: round1(longRunKm) },
    notes,
  };
}

// ---------------------------------------------------------------------------
// Building the block
// ---------------------------------------------------------------------------

const FRESH_BLOCK_ROLE = `You are Edu's personal running coach, writing week 1 of a brand-new training block after time away from this app. Nothing carries over from the previous plan: you size and shape this week from his recent Strava history, the way a coach would on a first session back — looking at what he has actually been doing, not at what an old plan said he would be doing.`;

const FRESH_BLOCK_BRIEF = `You will be given the background from his previous block (which may be stale — the Strava history is the current truth), his current zones, a summary of his recent Strava history, and hard guardrails the app has already computed for week 1 from that history. Treat the guardrails as non-negotiable caps. Shape of the week: 3 runs and 2 strength sessions, never two hard or long days back to back, at least one full rest day. His established rhythm is runs on Tuesday, Friday and Sunday with strength on Monday and Thursday — keep it unless the history shows a clear reason not to.

Personalise from the history, and say what you saw: if he has been in the gym regularly, build on that; if he has not run for weeks, start with run/walk and say why; if his recent runs show a heart rate that drifts high at an easy pace, set the belt speeds or paces accordingly. The "rationale" should read as a coach explaining the starting point — what the history shows, where the block therefore begins, and what the first few weeks are for. "weekVerdict" is one short line summing up where he is starting from (there is no "last week" in this plan to judge).`;

function buildFreshBlockSchema(exerciseNames: string[], setting: TrainingSetting) {
  return buildWeekResponseSchema(exerciseNames, setting).extend({
    blockFocus: z
      .string()
      .describe("One sentence: what this block as a whole is for, over roughly the next eight weeks."),
    strengths: z
      .array(z.string())
      .max(3)
      .describe("Up to 3 things the recent history shows he has going for him, each one sentence with its evidence."),
    limiters: z
      .array(z.string())
      .max(4)
      .describe(
        "Up to 4 things to manage in this block, each one sentence with its evidence — carry forward anything from the previous block's background that still applies (e.g. injury history)."
      ),
  });
}

function buildFreshBlockPrompt(params: {
  previous: PlanDocument | null;
  zones: unknown;
  history: TrainingHistory;
  guardrails: StartingGuardrails;
  weekStartDate: string;
  weekEndDate: string;
  todayStr: string;
}): string {
  const passedDays = DAY_NAMES.filter((_, i) => addDays(params.weekStartDate, i) < params.todayStr);
  const timing =
    params.weekStartDate > params.todayStr
      ? `Today is ${dayOfWeekName(params.todayStr)} ${params.todayStr}; the block starts on Monday ${params.weekStartDate}.`
      : passedDays.length > 0
        ? `Today is ${dayOfWeekName(params.todayStr)} ${params.todayStr}, so ${passedDays.join(" and ")} of this week ${passedDays.length > 1 ? "have" : "has"} already passed: give ${passedDays.length > 1 ? "each of those days" : "that day"} a single rest entry and fit the week's sessions into the days from today on.`
        : `Today is ${dayOfWeekName(params.todayStr)} ${params.todayStr}, the first day of the block.`;

  return `Background from his previous block (possibly stale): ${JSON.stringify(params.previous?.assessment ?? "none on record")}
Current HR/pace zones (live, as of the latest zone version — prescribe against these; pace zones may predate the time away, so lean on heart rate): ${JSON.stringify(params.zones)}

Recent Strava history as of ${params.history.asOf} (weeks are trailing 7-day windows, most recent first; "treadmill" is Strava's indoor flag):
${JSON.stringify(params.history, null, 2)}

Hard guardrails computed for week 1 (do not exceed these):
${JSON.stringify(params.guardrails, null, 2)}

Week 1 runs ${params.weekStartDate} to ${params.weekEndDate}, days ${DAY_NAMES.join(", ")}. ${timing}

A rest day is a workout entry with sport "rest". Every one of the 7 days must have at least one workout entry (use a rest-day entry for days with nothing planned). Distances in meters, metric only.`;
}

/**
 * What the /settings form starts from: the active plan's own setting when it
 * has one (so a second block defaults to how the first was trained), otherwise
 * the fresh-block default.
 */
export async function getDefaultFreshBlockSetting(): Promise<TrainingSetting> {
  const [activePlan] = await db
    .select({ planJson: plans.planJson })
    .from(plans)
    .where(eq(plans.isActive, true))
    .limit(1);
  return (activePlan?.planJson as PlanDocument | undefined)?.setting ?? DEFAULT_FRESH_BLOCK_SETTING;
}

export interface FreshBlockResult {
  /** Null on a dry run — nothing was written. */
  planId: string | null;
  version: number;
  weekStartDate: string;
  rationale: string;
  weekVerdict: string;
  warnings: string[];
  history: TrainingHistory;
  guardrails: StartingGuardrails;
  week: PlanWeekJson;
  setting: TrainingSetting;
}

/**
 * Builds week 1 of a new block and makes it the active plan. `todayStr` is the
 * athlete's local date. With `dryRun`, everything is generated and validated
 * but nothing is written.
 */
export async function startFreshBlock(params: {
  todayStr: string;
  setting: TrainingSetting;
  dryRun?: boolean;
}): Promise<FreshBlockResult> {
  const { todayStr, setting, dryRun = false } = params;

  // A new plan version is a coaching write like any other; the hold covers it.
  if (!dryRun && (await isPaused())) {
    throw new Error("Coaching is on hold — resume before starting a fresh block.");
  }

  const weekStartDate = blockStartDate(todayStr);
  const weekEndDate = addDays(weekStartDate, 6);

  const [activePlan] = await db.select().from(plans).where(eq(plans.isActive, true)).limit(1);
  const [latestPlan] = await db.select({ version: plans.version }).from(plans).orderBy(desc(plans.version)).limit(1);
  const previous = (activePlan?.planJson as PlanDocument | undefined) ?? null;

  const history = await summariseTrainingHistory(todayStr);
  const guardrails = computeStartingGuardrails(history);
  const currentZones = await getCurrentZoneVersion();

  const allExercises = await getAllExercises();
  const catalog = new ExerciseCatalog(allExercises).without(setting.avoidExercises);

  const llmBlock = await generateStructured({
    system: buildSystemPrompt(catalog, setting, { role: FRESH_BLOCK_ROLE, brief: FRESH_BLOCK_BRIEF }),
    prompt: buildFreshBlockPrompt({
      previous,
      zones: currentZones ?? previous?.zones ?? "none on record",
      history,
      guardrails,
      weekStartDate,
      weekEndDate,
      todayStr,
    }),
    schema: buildFreshBlockSchema(catalog.names, setting),
    toolName: "submit_fresh_block",
    toolDescription: "Submit week 1 of the new training block, fully specified, plus the block-level summary.",
    maxTokens: weekMaxTokens(setting),
  });

  const { week: clampedWeek, warnings } = clampToGuardrails(llmBlock, guardrails);

  const week: PlanWeekJson = {
    weekNumber: 1,
    startDate: weekStartDate,
    endDate: weekEndDate,
    phase: "base",
    focus: clampedWeek.focus,
    targetHours: clampedWeek.targetHours,
    isRecoveryWeek: false,
    days: materialiseDays(1, weekStartDate, clampedWeek, catalog),
  };

  const now = new Date().toISOString();
  const last4 = history.weeks.slice(0, 4);
  const plan: PlanDocument = {
    version: "1.0",
    meta: {
      id: `fresh-block-${weekStartDate}`,
      athlete: previous?.meta.athlete ?? "Edu",
      event: `Base block — ${settingLabel(setting)}`,
      // No race is attached to a fresh block. The dates describe the weeks
      // written so far; the Sunday job moves planEndDate on as it adds weeks.
      eventDate: weekEndDate,
      planStartDate: weekStartDate,
      planEndDate: weekEndDate,
      createdAt: now,
      updatedAt: now,
      totalWeeks: 1,
      generatedBy: `Claude Coach (fresh block from Strava history, ${COACHING_MODEL})`,
    },
    preferences: previous?.preferences ?? { run: "kilometers", firstDayOfWeek: "monday" },
    assessment: {
      foundation: previous?.assessment.foundation ?? {},
      currentForm: {
        asOf: todayStr,
        startingPoint: guardrails.startingPoint,
        weeklyVolume: { run: round1(last4.reduce((s, w) => s + w.runKm, 0) / 4) },
        longestSessions: { run: Math.max(0, ...last4.map((w) => w.longestRunKm)) },
        daysSinceLastRun: history.daysSinceLastRun,
        gymSessionsLast8Weeks: history.gymSessionsLast8Weeks,
        beforeTheGap: history.beforeTheGap,
      },
      strengths: llmBlock.strengths.map((evidence) => ({ evidence })),
      limiters: llmBlock.limiters.map((evidence) => ({ evidence })),
      constraints: [
        ...settingConstraints(setting),
        "3 runs and 2 strength sessions a week; runs Tuesday/Friday/Sunday and strength Monday/Thursday unless the week's data argues otherwise.",
      ],
    },
    zones: currentZones
      ? {
          run: {
            hr: {
              lthr: null,
              source: currentZones.source,
              zones: currentZones.hrZones as PlanDocument["zones"]["run"]["hr"]["zones"],
            },
            pace: {
              source: currentZones.source,
              zones: currentZones.paceZones as PlanDocument["zones"]["run"]["pace"]["zones"],
            },
            note: "Snapshot at the start of the block. The weekly job prescribes against the live zone version, not this copy.",
          },
        }
      : (previous?.zones ?? { run: { hr: { lthr: null, source: "none", zones: [] }, pace: { source: "none", zones: [] } } }),
    setting,
    phases: [{ name: "base", startWeek: 1, endWeek: 8, focus: llmBlock.blockFocus }],
    weeks: [week],
  };

  const version = (latestPlan?.version ?? 0) + 1;
  const planId = dryRun
    ? null
    : await persistPlanVersion({
        plan,
        version,
        weekStartDate,
        source: "fresh_block",
        rationale: clampedWeek.rationale,
        guardrailsApplied: {
          ...guardrails,
          warnings,
          model: COACHING_MODEL,
          weekVerdict: clampedWeek.weekVerdict,
          setting,
          history,
          supersededVersion: activePlan?.version ?? null,
        },
        supersedePlanId: activePlan?.id ?? null,
        allExercises,
      });

  return {
    planId,
    version,
    weekStartDate,
    rationale: clampedWeek.rationale,
    weekVerdict: clampedWeek.weekVerdict,
    warnings,
    history,
    guardrails,
    week,
    setting,
  };
}
