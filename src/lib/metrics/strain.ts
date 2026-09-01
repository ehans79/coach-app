import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityMetrics, dailyLoad } from "@/lib/db/schema";

/**
 * Composite training-strain flag — a pattern read across signals the Stage-1 engine
 * already computes, not a new measurement.
 *
 * Framing is load-bearing here, not decoration. Per Meeusen et al. (2013, the ECSS/ACSM
 * overtraining consensus, reference doc §2) there is NO validated single biomarker for
 * overreaching or overtraining syndrome: it is diagnosed by exclusion, over months. So
 * this can only ever say "several things at once look like accumulated fatigue" — never
 * that the athlete is overtrained. Two independent signals are required before anything
 * surfaces at all, precisely because any one of them alone has a mundane explanation
 * (a hot week, one badly-paced easy run, a deliberate overload block).
 */

// --- Signal thresholds ---------------------------------------------------------------

// ACWR. The reference doc's band is 0.8-1.3 with >1.5 flagged. Only the HIGH side counts
// toward STRAIN: an ACWR of 0.6 means the athlete is training less than usual, which is
// the opposite of accumulated fatigue. The low side is still reported as context on the
// assessment so the number itself isn't hidden — it just can't fire this flag.
const ACWR_ELEVATED = 1.3;
const ACWR_DANGER = 1.5;

// TSB. intervals.icu's form bands put -5..-30 at "optimal training" and <-30 at "high
// risk" — so a single deeply-negative day is normal training, and only a SUSTAINED run
// of them is worth noticing. Requiring both a low 14-day mean and most of those days
// individually deep keeps a one-off big weekend from firing it.
const TSB_WINDOW_DAYS = 14;
const TSB_SUSTAINED_MEAN = -20;
const TSB_DEEP_DAY = -20;
const TSB_MIN_DEEP_DAYS = 7;
const TSB_STRONG_MEAN = -30; // the doc's "high risk" band

// EF decline at matched effort. 5% mirrors the decoupling convention the codebase
// already uses as "a meaningful change in EF"; it is a reasoned choice, not a validated
// physiological cutoff (same caveat as efficiency.ts's STEADY_CV_THRESHOLD_PERCENT).
const EF_RECENT_WINDOW_DAYS = 7;
const EF_BASELINE_WINDOW_DAYS = 28;
const EF_MIN_BASELINE_RUNS = 3;
const EF_DECLINE_PERCENT = 5;
const EF_STRONG_DECLINE_PERCENT = 8;
// "At matched effort" is what makes an EF comparison mean anything — EF is speed per
// heartbeat, so comparing a hard week against an easy one measures the prescription,
// not fatigue. If the two pools' mean HR differ by more than this, the comparison is
// reported as not-comparable rather than as a signal.
const EF_MATCHED_HR_TOLERANCE_BPM = 5;

// "No good easy run in a while". <5% decoupling is the reference doc's marker of sound
// aerobic durability; >10% means the effort was above aerobic threshold or the athlete
// is under-conditioned. Needing several assessable easy runs before this can fire keeps
// one hot Sunday from counting.
const DECOUPLING_WINDOW_DAYS = 14;
const DECOUPLING_GOOD_PERCENT = 5;
const DECOUPLING_HIGH_PERCENT = 10;
const DECOUPLING_MIN_RUNS = 3;

/** Run types whose EF/decoupling should look clean if the athlete is recovering well. */
const EASY_RUN_TYPES = ["easy", "recovery", "long"] as const;

export type StrainSignalKey = "acwr" | "tsb" | "ef_decline" | "easy_run_decoupling";

export interface StrainSignal {
  key: StrainSignalKey;
  label: string;
  /** Fired, and so counts toward the flag. */
  fired: boolean;
  /** Fired at the more serious end of its range — raises severity, never fires alone. */
  strong: boolean;
  /** One plain-language line: what the number is and why it did or didn't count. */
  detail: string;
  /** False when there wasn't enough data to judge — distinct from "judged, and fine". */
  assessable: boolean;
}

export type StrainSeverity = "none" | "elevated" | "high";

export interface StrainAssessment {
  triggered: boolean;
  severity: StrainSeverity;
  firedCount: number;
  signals: StrainSignal[];
  /** Banner headline. Conservative by construction — never a diagnosis. */
  headline: string;
  /** Supporting line under the headline. */
  body: string;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

interface EasyRunSample {
  date: string;
  efficiencyFactor: number | null;
  decouplingPercent: number | null;
  avgHeartrate: number | null;
}

/** Steady easy/recovery/long runs in a date range, with the metrics this flag reads. */
async function loadEasyRunSamples(fromDate: string, toDate: string): Promise<EasyRunSample[]> {
  const rows = await db
    .select({
      startDateLocal: activities.startDateLocal,
      efficiencyFactor: activityMetrics.efficiencyFactor,
      decouplingPercent: activityMetrics.decouplingPercent,
      avgHeartrate: activities.averageHeartrate,
    })
    .from(activityMetrics)
    .innerJoin(activities, eq(activityMetrics.activityId, activities.id))
    .where(
      and(
        eq(activities.sportType, "Run"),
        eq(activityMetrics.isSteady, true),
        inArray(activityMetrics.runType, [...EASY_RUN_TYPES]),
        gte(activities.startDateLocal, new Date(`${fromDate}T00:00:00Z`)),
        lte(activities.startDateLocal, new Date(`${toDate}T23:59:59Z`))
      )
    );
  return rows.map((r) => ({
    date: r.startDateLocal.toISOString().slice(0, 10),
    efficiencyFactor: r.efficiencyFactor,
    decouplingPercent: r.decouplingPercent,
    avgHeartrate: r.avgHeartrate,
  }));
}

function buildAcwrSignal(acwr: number | null): StrainSignal {
  if (acwr == null) {
    return {
      key: "acwr",
      label: "Training-load ramp",
      fired: false,
      strong: false,
      assessable: false,
      detail: "Not enough history yet for an acute:chronic ratio (needs 28 days).",
    };
  }
  const value = acwr.toFixed(2);
  if (acwr > ACWR_DANGER) {
    return {
      key: "acwr",
      label: "Training-load ramp",
      fired: true,
      strong: true,
      assessable: true,
      detail: `Acute:chronic load ratio is ${value} — well above the 0.8-1.3 band, so the last week is a big step up on the three before it.`,
    };
  }
  if (acwr > ACWR_ELEVATED) {
    return {
      key: "acwr",
      label: "Training-load ramp",
      fired: true,
      strong: false,
      assessable: true,
      detail: `Acute:chronic load ratio is ${value}, just above the 0.8-1.3 band — you've ramped up faster than usual.`,
    };
  }
  if (acwr < 0.8) {
    // Reported, deliberately not counted — see the ACWR_ELEVATED note above.
    return {
      key: "acwr",
      label: "Training-load ramp",
      fired: false,
      strong: false,
      assessable: true,
      detail: `Acute:chronic load ratio is ${value}, below the 0.8-1.3 band — that's a lighter week than usual, not a strain signal.`,
    };
  }
  return {
    key: "acwr",
    label: "Training-load ramp",
    fired: false,
    strong: false,
    assessable: true,
    detail: `Acute:chronic load ratio is ${value} — inside the 0.8-1.3 band.`,
  };
}

function buildTsbSignal(tsbValues: number[]): StrainSignal {
  const label = "Form (TSB)";
  if (tsbValues.length < TSB_WINDOW_DAYS) {
    return {
      key: "tsb",
      label,
      fired: false,
      strong: false,
      assessable: false,
      detail: `Needs ${TSB_WINDOW_DAYS} days of load history to judge a sustained trend.`,
    };
  }
  const meanTsb = mean(tsbValues);
  const deepDays = tsbValues.filter((t) => t <= TSB_DEEP_DAY).length;
  const fired = meanTsb <= TSB_SUSTAINED_MEAN && deepDays >= TSB_MIN_DEEP_DAYS;
  return {
    key: "tsb",
    label,
    fired,
    strong: fired && meanTsb <= TSB_STRONG_MEAN,
    assessable: true,
    detail: fired
      ? `Form has averaged ${meanTsb.toFixed(0)} over the last ${TSB_WINDOW_DAYS} days, ${deepDays} of them at or below ${TSB_DEEP_DAY} — a sustained stretch of carrying fatigue, not a single hard weekend.`
      : `Form has averaged ${meanTsb.toFixed(0)} over the last ${TSB_WINDOW_DAYS} days — normal training territory.`,
  };
}

function buildEfSignal(recent: EasyRunSample[], baseline: EasyRunSample[]): StrainSignal {
  const label = "Efficiency at matched effort";
  const recentUsable = recent.filter((r) => r.efficiencyFactor != null && r.avgHeartrate != null);
  const baselineUsable = baseline.filter((r) => r.efficiencyFactor != null && r.avgHeartrate != null);

  if (recentUsable.length === 0 || baselineUsable.length < EF_MIN_BASELINE_RUNS) {
    return {
      key: "ef_decline",
      label,
      fired: false,
      strong: false,
      assessable: false,
      detail: `Needs a steady easy run this week and ${EF_MIN_BASELINE_RUNS} in the previous four to compare against — ${recentUsable.length} and ${baselineUsable.length} so far.`,
    };
  }

  const recentHr = mean(recentUsable.map((r) => r.avgHeartrate!));
  const baselineHr = mean(baselineUsable.map((r) => r.avgHeartrate!));
  if (Math.abs(recentHr - baselineHr) > EF_MATCHED_HR_TOLERANCE_BPM) {
    return {
      key: "ef_decline",
      label,
      fired: false,
      strong: false,
      assessable: false,
      detail: `This week's easy runs averaged ${recentHr.toFixed(0)}bpm against ${baselineHr.toFixed(0)}bpm over the previous four weeks — too far apart to call it a matched-effort comparison.`,
    };
  }

  const recentEf = mean(recentUsable.map((r) => r.efficiencyFactor!));
  const baselineEf = mean(baselineUsable.map((r) => r.efficiencyFactor!));
  const declinePercent = baselineEf > 0 ? ((baselineEf - recentEf) / baselineEf) * 100 : 0;
  const fired = declinePercent >= EF_DECLINE_PERCENT;
  return {
    key: "ef_decline",
    label,
    fired,
    strong: fired && declinePercent >= EF_STRONG_DECLINE_PERCENT,
    assessable: true,
    detail: fired
      ? `You're covering ${declinePercent.toFixed(1)}% less ground per heartbeat on easy runs this week than your four-week average, at the same heart rate (${recentHr.toFixed(0)} vs ${baselineHr.toFixed(0)}bpm).`
      : `Ground covered per heartbeat on easy runs is within ${Math.abs(declinePercent).toFixed(1)}% of your four-week average at matched heart rate.`,
  };
}

function buildDecouplingSignal(samples: EasyRunSample[]): StrainSignal {
  const label = "Easy-run aerobic drift";
  const usable = samples.filter((s) => s.decouplingPercent != null);
  if (usable.length < DECOUPLING_MIN_RUNS) {
    return {
      key: "easy_run_decoupling",
      label,
      fired: false,
      strong: false,
      assessable: false,
      detail: `Needs ${DECOUPLING_MIN_RUNS} steady easy runs in the last ${DECOUPLING_WINDOW_DAYS} days to judge — ${usable.length} so far.`,
    };
  }
  const values = usable.map((s) => s.decouplingPercent!);
  const cleanRuns = values.filter((v) => v < DECOUPLING_GOOD_PERCENT).length;
  const highRuns = values.filter((v) => v > DECOUPLING_HIGH_PERCENT).length;
  const fired = cleanRuns === 0;
  return {
    key: "easy_run_decoupling",
    label,
    fired,
    strong: fired && highRuns >= 2,
    assessable: true,
    detail: fired
      ? `None of your last ${usable.length} steady easy runs held heart rate flat enough to clear the ${DECOUPLING_GOOD_PERCENT}% drift mark (${values.map((v) => `${v.toFixed(1)}%`).join(", ")}) — heat and fuelling do this too, not just fatigue.`
      : `${cleanRuns} of your last ${usable.length} steady easy runs came in under ${DECOUPLING_GOOD_PERCENT}% aerobic drift.`,
  };
}

/**
 * The conservatism rule itself, kept pure and exported so it can be exercised directly:
 * fewer than two fired signals never surfaces anything, and severity only escalates on
 * a third signal or one at the serious end of its range.
 */
export function summariseStrainSignals(signals: StrainSignal[]): Pick<StrainAssessment, "triggered" | "severity" | "headline" | "body" | "firedCount"> {
  const fired = signals.filter((s) => s.fired);
  const firedCount = fired.length;

  if (firedCount < 2) {
    return {
      triggered: false,
      severity: "none",
      firedCount,
      headline: "Nothing in the fatigue signals worth acting on",
      body:
        firedCount === 1
          ? "One signal is sitting outside its usual range, which on its own is normal training noise. Worth a flag only if a second one joins it."
          : "Load ramp, form, efficiency and easy-run drift are all reading normally.",
    };
  }

  const severity: StrainSeverity = firedCount >= 3 || fired.some((s) => s.strong) ? "high" : "elevated";
  return {
    triggered: true,
    severity,
    firedCount,
    headline:
      severity === "high"
        ? "A few signals suggest you're carrying more fatigue than usual — an easier week is worth considering"
        : "A couple of signals suggest you might be carrying more fatigue than usual",
    body:
      `${firedCount} of the four things worth watching are outside their usual range at once. None of this diagnoses anything — ` +
      "there's no single reliable marker for overreaching, and heat, sleep, work stress and fuelling all move these same numbers. " +
      "Treat it as a prompt to look at the week ahead, not a verdict on it.",
  };
}

/**
 * Reads the flag for a given date (defaults to today). Pure query — nothing is
 * persisted, so it re-derives from whatever activity_metrics/daily_load currently hold
 * and self-heals after any backfill, exactly like computeDailyRollup.
 */
export async function assessTrainingStrain(asOfDateStr?: string): Promise<StrainAssessment> {
  const asOf = asOfDateStr ?? new Date().toISOString().slice(0, 10);

  const [latestLoad] = await db
    .select({ acwr: dailyLoad.acwr })
    .from(dailyLoad)
    .where(lte(dailyLoad.date, asOf))
    .orderBy(desc(dailyLoad.date))
    .limit(1);

  const tsbRows = await db
    .select({ tsb: dailyLoad.tsb })
    .from(dailyLoad)
    .where(and(gte(dailyLoad.date, addDays(asOf, -(TSB_WINDOW_DAYS - 1))), lte(dailyLoad.date, asOf)))
    .orderBy(desc(dailyLoad.date));

  const recentEasyRuns = await loadEasyRunSamples(addDays(asOf, -(EF_RECENT_WINDOW_DAYS - 1)), asOf);
  const baselineEasyRuns = await loadEasyRunSamples(
    addDays(asOf, -(EF_RECENT_WINDOW_DAYS + EF_BASELINE_WINDOW_DAYS - 1)),
    addDays(asOf, -EF_RECENT_WINDOW_DAYS)
  );
  const decouplingRuns = await loadEasyRunSamples(addDays(asOf, -(DECOUPLING_WINDOW_DAYS - 1)), asOf);

  const signals: StrainSignal[] = [
    buildAcwrSignal(latestLoad?.acwr ?? null),
    buildTsbSignal(tsbRows.map((r) => r.tsb)),
    buildEfSignal(recentEasyRuns, baselineEasyRuns),
    buildDecouplingSignal(decouplingRuns),
  ];

  return { ...summariseStrainSignals(signals), signals };
}
