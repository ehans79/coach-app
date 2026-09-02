import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { coachReads } from "@/lib/db/schema";
import { generateText, COACHING_MODEL } from "@/lib/llm/anthropic";
import { formatDuration, formatPace } from "@/lib/format";
import {
  getVdotView,
  getCriticalSpeedView,
  getPowerDurationView,
  getWeeklyIntensityDistribution,
} from "@/lib/dashboard/queries";
import { assessTrainingStrain, type StrainSeverity } from "@/lib/metrics/strain";

/**
 * The coach's read — one short synthesis of everything the Trends dashboard
 * already shows, written once per week and rendered in two places (the top of
 * Trends, and the opening paragraph of the weekly debrief email) from the same
 * stored text.
 *
 * The point is interpretation, not another metric: every number involved is
 * already on screen somewhere, and a runner reading nine separate panels still
 * has to do the joining-up themselves. What this cannot become is a tenth
 * number, or a diagnosis — the same conservatism strain.ts is built around
 * applies here, and more so, since this is the one bit of the app that speaks
 * about all the signals at once.
 */

// The individual reads the summary is allowed to draw on. Counted rather than
// inspected ad-hoc so "how much do we actually know right now?" is a
// deterministic app-side decision (like determineFlag/summariseStrainSignals)
// rather than something the model infers from a blob of nulls.
const READ_LABELS = {
  vdot: "estimated fitness (VDOT)",
  thresholdPace: "a measured threshold pace",
  criticalSpeed: "a Critical Speed fit",
  criticalPower: "a Critical Power fit",
  acwr: "the training-load ramp signal",
  tsb: "the form (TSB) signal",
  ef_decline: "the efficiency-at-matched-effort signal",
  easy_run_decoupling: "the easy-run aerobic-drift signal",
  intensityDistribution: "a weekly intensity split",
} as const;

type ReadKey = keyof typeof READ_LABELS;

/**
 * At or below this many readable signals out of nine, there is genuinely not
 * enough training history to say much — early in a return-to-running phase, a
 * single week of easy runs produces an intensity split and nothing else. The
 * summary is told to be short and honest about that rather than dressing up
 * four "not enough data yet" states as an insight.
 */
const SPARSE_MAX_AVAILABLE_READS = 3;

const POLARIZED_TARGET = "roughly 80% of weekly run time low-intensity, the remainder moderate/high (Seiler's 80/20)";

export interface CoachsReadInputs {
  week: { startDate: string; endDate: string };
  fitness: {
    /** Null until a race-quality effort lands inside the freshness window. */
    vdot: {
      value: number;
      effortDate: string;
      daysAgo: number;
      effortLabel: string;
      sourceLabel: string;
      freshnessWindowDays: number;
    } | null;
    /** Set only when the most recent qualifying effort has aged out of that window. */
    staleVdot: { value: number; effortDate: string; daysAgo: number } | null;
    changeVsPrevious: { delta: number; previousVdot: number; previousDate: string } | null;
    thresholdPace: {
      pace: string;
      asOfDate: string;
      isProvisional: boolean;
      derivedFromVdot: boolean;
    } | null;
  };
  criticalSpeed: {
    pace: string;
    dPrimeMeters: number;
    rSquared: number;
    pointsUsed: number;
    caveat: string;
  } | null;
  criticalPower: {
    watts: number;
    wPrimeKj: number;
    rSquared: number;
    pointsUsed: number;
    caveat: string;
  } | null;
  fatigue: {
    triggered: boolean;
    severity: StrainSeverity;
    firedCount: number;
    headline: string;
    signals: {
      label: string;
      state: "fired" | "clear" | "not_enough_data";
      strong: boolean;
      detail: string;
    }[];
  };
  intensityDistribution: {
    weekStart: string;
    lowPercent: number;
    moderatePercent: number;
    highPercent: number;
    target: string;
  } | null;
  coverage: {
    availableReads: number;
    totalReads: number;
    isSparse: boolean;
    /** Plain-language names of what isn't readable yet — never recited in full, but
     * it's what lets the model say "most of this is still filling in" honestly. */
    missing: string[];
  };
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

const CS_CAVEAT =
  "Fitted from ordinary training runs rather than maximal tests, so it reads low until genuinely hard efforts accumulate.";
const CP_CAVEAT =
  "Wrist-based power estimate from the watch, not a foot pod — a self-consistent internal reference, not a measured wattage.";

/**
 * Assembles exactly what the Trends dashboard shows for the given week, in the
 * shape the summary is written from. Pure read — the same query layer the page
 * itself renders through, so the two can't drift apart.
 */
export async function buildCoachsReadInputs(weekStartDate: string, weekEndDate: string): Promise<CoachsReadInputs> {
  const [vdotView, cs, cp, strain, intensity] = await Promise.all([
    getVdotView(),
    getCriticalSpeedView(),
    getPowerDurationView(),
    assessTrainingStrain(weekEndDate),
    getWeeklyIntensityDistribution(),
  ]);

  const weekIntensity = intensity.find((w) => w.weekStart === mondayOf(weekStartDate)) ?? null;
  // A week with zero recorded run time yields 0/0/0 rather than no row at all —
  // that's an absent read, not a 100%-nothing split.
  const hasIntensity =
    weekIntensity != null &&
    weekIntensity.lowPercent + weekIntensity.moderatePercent + weekIntensity.highPercent > 0;

  const available = new Set<ReadKey>();
  if (vdotView.current) available.add("vdot");
  // A provisional threshold is a placeholder the load engine needs, not a
  // fitness read — it says nothing about how the athlete is going.
  if (vdotView.activeThreshold && !vdotView.activeThreshold.isProvisional) available.add("thresholdPace");
  if (cs.fit) available.add("criticalSpeed");
  if (cp.fit) available.add("criticalPower");
  for (const signal of strain.signals) {
    if (signal.assessable) available.add(signal.key);
  }
  if (hasIntensity) available.add("intensityDistribution");

  const missing = (Object.keys(READ_LABELS) as ReadKey[])
    .filter((key) => !available.has(key))
    .map((key) => READ_LABELS[key]);

  return {
    week: { startDate: weekStartDate, endDate: weekEndDate },
    fitness: {
      vdot: vdotView.current
        ? {
            value: vdotView.current.vdot,
            effortDate: vdotView.current.effortDate,
            daysAgo: vdotView.current.daysAgo,
            effortLabel: `${vdotView.current.distanceKm.toFixed(2)}km in ${formatDuration(vdotView.current.durationSeconds)}`,
            sourceLabel:
              vdotView.current.source === "strava_race" ? "race" : "detected time-trial-quality effort",
            freshnessWindowDays: vdotView.windowDays,
          }
        : null,
      staleVdot: vdotView.lastKnown
        ? {
            value: vdotView.lastKnown.vdot,
            effortDate: vdotView.lastKnown.effortDate,
            daysAgo: vdotView.lastKnown.daysAgo,
          }
        : null,
      changeVsPrevious: vdotView.changeVsPrevious,
      thresholdPace: vdotView.activeThreshold
        ? {
            pace: formatPace(vdotView.activeThreshold.thresholdPaceSecPerKm),
            asOfDate: vdotView.activeThreshold.asOfDate,
            isProvisional: vdotView.activeThreshold.isProvisional,
            derivedFromVdot: vdotView.activeThreshold.derivedFromVdot,
          }
        : null,
    },
    criticalSpeed: cs.fit
      ? {
          pace: formatPace(cs.fit.criticalSpeedPaceSecPerKm),
          dPrimeMeters: Math.round(cs.fit.dPrimeMeters),
          rSquared: Math.round(cs.fit.rSquared * 1000) / 1000,
          pointsUsed: cs.fit.points.length,
          caveat: CS_CAVEAT,
        }
      : null,
    criticalPower: cp.fit
      ? {
          watts: Math.round(cp.fit.criticalPowerWatts),
          wPrimeKj: Math.round((cp.fit.wPrimeJoules / 1000) * 10) / 10,
          rSquared: Math.round(cp.fit.rSquared * 1000) / 1000,
          pointsUsed: cp.fit.points.length,
          caveat: CP_CAVEAT,
        }
      : null,
    fatigue: {
      triggered: strain.triggered,
      severity: strain.severity,
      firedCount: strain.firedCount,
      headline: strain.headline,
      signals: strain.signals.map((s) => ({
        label: s.label,
        state: !s.assessable ? "not_enough_data" : s.fired ? "fired" : "clear",
        strong: s.strong,
        detail: s.detail,
      })),
    },
    intensityDistribution: hasIntensity
      ? {
          weekStart: weekIntensity!.weekStart,
          lowPercent: weekIntensity!.lowPercent,
          moderatePercent: weekIntensity!.moderatePercent,
          highPercent: weekIntensity!.highPercent,
          target: POLARIZED_TARGET,
        }
      : null,
    coverage: {
      availableReads: available.size,
      totalReads: Object.keys(READ_LABELS).length,
      isSparse: available.size <= SPARSE_MAX_AVAILABLE_READS,
      missing,
    },
  };
}

const SYSTEM_PROMPT = `You are Edu's personal running coach, writing the two-to-four-sentence opening of a weekly check-in. It appears at the top of his Trends dashboard and as the first paragraph of his weekly email, above all the detailed numbers.

This is the part where a coach says "here's the shape of it" before going through the data. Everything you'll be given is already displayed to him somewhere on that page — your job is the synthesis he'd otherwise have to do himself: what's going well, what's worth watching, what (if anything) needs attention this week.

Style: direct, warm, specific — the same voice as the per-run comments. Second person. 2-4 sentences, no headings, no bullet points, no lists, no sign-off. Metric units only (km, min:sec/km, °C).

What this must NOT be:
- A re-listing of the numbers. He can read the panels. Quote a specific figure only when it carries the point of a sentence, and never more than one or two in the whole paragraph.
- Diagnostic. None of these are measurements of his body: CTL/ATL/TSB/ACWR/EF/decoupling are models built from his own training log, VDOT assumes an all-out effort on an accurate course, and the Critical Speed and Critical Power fits come from ordinary training runs rather than maximal tests. Talk about them the way a coach reads a training log ("you've ramped up faster than usual") — never as a printout ("your ACWR is 1.6"), and never as a verdict on his health.
- Falsely precise. Two decimal places, "12.4% improvement in aerobic efficiency", or any claim the data can't carry.
- Manufactured concern. A signal sitting comfortably inside its normal range is not a finding. If nothing needs attention, say so and stop — a short paragraph is a good outcome, not a thin one.

Saying "not sure yet" is always available to you and is often the honest answer. A fatigue signal marked "not_enough_data" has NOT been judged and found fine — it simply couldn't be read; never treat the two as the same. The app already decided, deterministically, whether anything is flagged (fatigue.triggered / fatigue.severity) — explain that verdict in coach language rather than reaching a different one of your own.

SPARSE DATA — when coverage.isSparse is true, most signals can't be read yet (typically early in a return-to-running phase). Then the whole paragraph should be one or two short sentences that say so honestly and find the one true thing worth saying, e.g. "Not enough training history yet to say much beyond: you're back running, which is the right first step." Do not enumerate the missing metrics, do not explain what each one will eventually show, and do not stretch the one or two readable signals into a fuller picture than they support. Short and honest beats complete.

Write only the paragraph itself — no preamble, no quotation marks around it.`;

function buildPrompt(inputs: CoachsReadInputs): string {
  return `Week under review: ${inputs.week.startDate} to ${inputs.week.endDate}.

${
  inputs.coverage.isSparse
    ? `NOTE: only ${inputs.coverage.availableReads} of ${inputs.coverage.totalReads} signals are readable this week — this is the sparse-data case. Keep it to one or two honest sentences.`
    : `${inputs.coverage.availableReads} of ${inputs.coverage.totalReads} signals are readable this week.`
}

Everything currently on the Trends dashboard for this week (JSON):
${JSON.stringify(inputs, null, 2)}

Write the coach's read now.`;
}

export interface CoachsRead {
  weekStartDate: string;
  weekEndDate: string;
  summaryText: string;
  isSparse: boolean;
  availableReadCount: number;
  totalReadCount: number;
  generatedAt: Date;
}

function toCoachsRead(row: typeof coachReads.$inferSelect): CoachsRead {
  return {
    weekStartDate: row.weekStartDate,
    weekEndDate: row.weekEndDate,
    summaryText: row.summaryText,
    isSparse: row.isSparse,
    availableReadCount: row.availableReadCount,
    totalReadCount: row.totalReadCount,
    generatedAt: row.generatedAt,
  };
}

/**
 * Generates the coach's read for one week and stores it. Upserts on the week,
 * so re-running the Sunday job (or replaying it against a past date) replaces
 * that week's read rather than accumulating duplicates.
 */
export async function generateCoachsRead(weekStartDate: string, weekEndDate: string): Promise<CoachsRead> {
  const inputs = await buildCoachsReadInputs(weekStartDate, weekEndDate);

  const summaryText = await generateText({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(inputs),
    maxTokens: 768,
  });

  const row = {
    weekStartDate,
    weekEndDate,
    summaryText,
    isSparse: inputs.coverage.isSparse,
    availableReadCount: inputs.coverage.availableReads,
    totalReadCount: inputs.coverage.totalReads,
    inputs,
    model: COACHING_MODEL,
    generatedAt: new Date(),
  };

  const [inserted] = await db
    .insert(coachReads)
    .values(row)
    .onConflictDoUpdate({ target: coachReads.weekStartDate, set: row })
    .returning();

  return toCoachsRead(inserted);
}

/**
 * In healthy operation the latest read is at most 7 days old: the Sunday job
 * writes it that evening for the week just ended, and the following Sunday
 * replaces it. Past that, at least one Sunday has been missed — which matters
 * more here than for a stale number, because every panel below the read on
 * Trends is queried live. A silently old paragraph is the one way that page can
 * end up contradicting itself.
 */
export const COACHS_READ_STALE_AFTER_DAYS = 7;

export interface CoachsReadFreshness {
  /** Days between the end of the week the read covers and today. */
  ageDays: number;
  isStale: boolean;
  /** "9 days old" / "3 weeks old" — set only when stale, since that's the only
   * time the age is worth saying out loud. */
  ageLabel: string | null;
}

/** Pure, and exported separately from the query so it can be exercised directly. */
export function assessCoachsReadFreshness(
  read: CoachsRead | null,
  asOfDateStr?: string
): CoachsReadFreshness | null {
  if (!read) return null;
  const asOf = asOfDateStr ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.max(
    0,
    Math.round(
      (new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${read.weekEndDate}T00:00:00Z`).getTime()) / 86_400_000
    )
  );
  const isStale = ageDays > COACHS_READ_STALE_AFTER_DAYS;
  return {
    ageDays,
    isStale,
    // Below two weeks "1 week old" reads as rounder than the truth, so days
    // carry it until weeks genuinely say more.
    ageLabel: isStale ? (ageDays >= 14 ? `${Math.floor(ageDays / 7)} weeks old` : `${ageDays} days old`) : null,
  };
}

/** The read for one specific week — what the weekly email opens with. */
export async function getCoachsReadForWeek(weekStartDate: string): Promise<CoachsRead | null> {
  const [row] = await db.select().from(coachReads).where(eq(coachReads.weekStartDate, weekStartDate)).limit(1);
  return row ? toCoachsRead(row) : null;
}

/** The most recent read of any week — what the Trends dashboard opens with. */
export async function getLatestCoachsRead(): Promise<CoachsRead | null> {
  const [row] = await db.select().from(coachReads).orderBy(desc(coachReads.weekStartDate)).limit(1);
  return row ? toCoachsRead(row) : null;
}
