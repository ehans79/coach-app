import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { criticalSpeedFits } from "@/lib/db/schema";
import { getBestEfforts, type BestEffortPoint } from "./bestEfforts";

/**
 * Critical Speed / D′ from the two-parameter hyperbolic model in its linear form,
 * distance = CS·t + D′ (Monod & Scherrer 1965; Jones & Vanhatalo 2017, reference doc
 * §2/§6). CS is the slope — the speed asymptote separating the heavy and severe
 * intensity domains — and D′ the intercept, the finite distance runnable above it.
 */

// Fit window. The classic protocol uses maximal efforts of roughly 2-15 min, where the
// hyperbola is well-conditioned: shorter efforts are dominated by D′ and longer ones by
// substrate/thermoregulation rather than CS, both of which bend the line. 30 min is kept
// as the upper bound because with this athlete's sparse history dropping to 20 would
// often leave too few points to fit at all; 60 min is deliberately excluded.
const FIT_MIN_DURATION_SECONDS = 120;
const FIT_MAX_DURATION_SECONDS = 1800;
// Two points define a line but say nothing about whether the model fits. Three is the
// minimum at which r² carries any information.
const MIN_FIT_POINTS = 3;

// Plausibility rails. A fit outside these means the curve is being driven by something
// other than sustainable speed (near-identical points, a GPS artefact, a curve built
// entirely from easy running) and is better reported as "not enough good data" than
// shown as a number.
const MIN_PLAUSIBLE_CS_MPS = 1000 / (15 * 60); // 15:00/km
const MAX_PLAUSIBLE_CS_MPS = 1000 / (2 * 60); // 2:00/km

export interface CriticalSpeedFit {
  criticalSpeedMps: number;
  criticalSpeedPaceSecPerKm: number;
  dPrimeMeters: number;
  rSquared: number;
  points: { durationSeconds: number; gradedSpeedMps: number; activityId: number; achievedOn: string }[];
}

export interface CriticalSpeedFitResult {
  fit: CriticalSpeedFit | null;
  /** Why no fit, when `fit` is null — surfaced verbatim in the chart's empty state. */
  reason: string | null;
}

/** Ordinary least squares of distance on time over the eligible best efforts. */
export function fitCriticalSpeed(efforts: BestEffortPoint[]): CriticalSpeedFitResult {
  const points = efforts
    .filter((e) => e.durationSeconds >= FIT_MIN_DURATION_SECONDS && e.durationSeconds <= FIT_MAX_DURATION_SECONDS)
    .sort((a, b) => a.durationSeconds - b.durationSeconds);

  if (points.length < MIN_FIT_POINTS) {
    return {
      fit: null,
      reason: `Needs best efforts at ${MIN_FIT_POINTS} durations between 2 and 30 minutes — ${points.length} so far.`,
    };
  }

  const times = points.map((p) => p.durationSeconds);
  const distances = points.map((p) => p.gradedSpeedMps * p.durationSeconds);
  const n = points.length;
  const meanT = times.reduce((a, b) => a + b, 0) / n;
  const meanD = distances.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let varianceT = 0;
  for (let i = 0; i < n; i++) {
    covariance += (times[i] - meanT) * (distances[i] - meanD);
    varianceT += (times[i] - meanT) ** 2;
  }
  if (varianceT === 0) return { fit: null, reason: "Best efforts don't span enough different durations to fit." };

  const criticalSpeedMps = covariance / varianceT;
  const dPrimeMeters = meanD - criticalSpeedMps * meanT;

  if (criticalSpeedMps < MIN_PLAUSIBLE_CS_MPS || criticalSpeedMps > MAX_PLAUSIBLE_CS_MPS) {
    return { fit: null, reason: "The fitted speed came out implausible — the curve needs harder, more varied efforts." };
  }
  // A negative D′ means the short efforts sit BELOW the line the longer ones describe:
  // physiologically impossible, and in practice a sign that no genuinely hard short
  // effort exists in the history yet.
  if (dPrimeMeters <= 0) {
    return {
      fit: null,
      reason: "No hard short efforts yet — the 2-5 minute end of the curve is too slow for the model to fit.",
    };
  }

  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (let i = 0; i < n; i++) {
    const predicted = criticalSpeedMps * times[i] + dPrimeMeters;
    residualSumSquares += (distances[i] - predicted) ** 2;
    totalSumSquares += (distances[i] - meanD) ** 2;
  }
  const rSquared = totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : 1;

  return {
    fit: {
      criticalSpeedMps,
      criticalSpeedPaceSecPerKm: 1000 / criticalSpeedMps,
      dPrimeMeters,
      rSquared,
      points: points.map((p) => ({
        durationSeconds: p.durationSeconds,
        gradedSpeedMps: p.gradedSpeedMps,
        activityId: p.activityId,
        achievedOn: p.achievedOn,
      })),
    },
    reason: null,
  };
}

/** Predicted sustainable speed at duration t under the fitted model: v(t) = CS + D′/t. */
export function predictedSpeedAt(fit: Pick<CriticalSpeedFit, "criticalSpeedMps" | "dPrimeMeters">, seconds: number) {
  return fit.criticalSpeedMps + fit.dPrimeMeters / seconds;
}

/**
 * Refits CS from the current best-efforts curve and stores a new version row if it
 * succeeded. Called from the weekly regeneration job, not on every sync — a single new
 * activity rarely moves the curve, and refitting nightly would fill the history with
 * near-identical versions.
 */
export async function refitCriticalSpeed(asOfDateStr?: string): Promise<CriticalSpeedFitResult> {
  const asOf = asOfDateStr ?? new Date().toISOString().slice(0, 10);
  const efforts = await getBestEfforts();
  const result = fitCriticalSpeed(efforts);
  if (!result.fit) return result;

  const fit = result.fit;
  await db.transaction(async (tx) => {
    await tx.update(criticalSpeedFits).set({ isCurrent: false }).where(eq(criticalSpeedFits.isCurrent, true));
    await tx.insert(criticalSpeedFits).values({
      asOfDate: asOf,
      criticalSpeedMps: fit.criticalSpeedMps,
      dPrimeMeters: fit.dPrimeMeters,
      rSquared: fit.rSquared,
      pointCount: fit.points.length,
      pointsUsed: fit.points,
      isCurrent: true,
    });
  });
  return result;
}

export interface CurrentCriticalSpeed extends CriticalSpeedFit {
  asOfDate: string;
}

export async function getCurrentCriticalSpeed(): Promise<CurrentCriticalSpeed | null> {
  const [row] = await db
    .select()
    .from(criticalSpeedFits)
    .where(eq(criticalSpeedFits.isCurrent, true))
    .orderBy(desc(criticalSpeedFits.asOfDate))
    .limit(1);
  if (!row) return null;
  return {
    asOfDate: row.asOfDate,
    criticalSpeedMps: row.criticalSpeedMps,
    criticalSpeedPaceSecPerKm: 1000 / row.criticalSpeedMps,
    dPrimeMeters: row.dPrimeMeters,
    rSquared: row.rSquared ?? 0,
    points: (row.pointsUsed as CriticalSpeedFit["points"] | null) ?? [],
  };
}

// Durability benchmarks from Jones & Vanhatalo's analysis of 12 world-class marathoners
// (~96% of CS) and Smyth & Muniz-Pumares 2020's recreational cohort (~85%), reference
// doc §2. Comparison points for reading a race back, NOT targets — chasing a higher
// %CS by going out harder is how a race falls apart.
export const CS_BENCHMARK_ELITE_MARATHON_PERCENT = 96;
export const CS_BENCHMARK_RECREATIONAL_MARATHON_PERCENT = 85;

export interface DurabilityRead {
  percentOfCriticalSpeed: number;
  criticalSpeedPaceSecPerKm: number;
  csAsOfDate: string;
  /** How the effort's duration compares to the marathon the benchmarks were measured over. */
  benchmarkCaveat: string;
}

/**
 * "% of Critical Speed sustained" for one effort — the durability read the reference
 * doc calls for on race efforts. Both speeds are grade-adjusted, so a hilly race isn't
 * penalised against a CS fitted on flatter running.
 */
export async function computePercentOfCriticalSpeed(
  gradedSpeedMps: number,
  durationSeconds: number
): Promise<DurabilityRead | null> {
  const cs = await getCurrentCriticalSpeed();
  if (!cs || cs.criticalSpeedMps <= 0) return null;
  return {
    percentOfCriticalSpeed: (gradedSpeedMps / cs.criticalSpeedMps) * 100,
    criticalSpeedPaceSecPerKm: cs.criticalSpeedPaceSecPerKm,
    csAsOfDate: cs.asOfDate,
    benchmarkCaveat:
      durationSeconds < 3600
        ? "The ~96% (elite) / ~85% (recreational) figures come from marathons — a shorter effort sits higher on the curve by definition, so read this as a rough orientation rather than a like-for-like comparison."
        : "The ~96% (elite) / ~85% (recreational) figures come from marathon performances, so this is roughly comparable — still a comparison point, not a target.",
  };
}
