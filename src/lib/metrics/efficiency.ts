import type { StreamData } from "@/lib/coaching/streams";
import { computeNGPRange } from "./ngp";

const BIN_SECONDS = 60;
// Calibrated against this athlete's actual backfilled history, not generic
// literature norms — a literature-derived ~6% guess turned out to gate out
// nearly every run (median CV even among easy/recovery/long runs was ~10%,
// likely reflecting hillier terrain than a flat-course assumption: several runs
// here average 2-5% grade). 9% sits just below that median, so roughly the more
// consistent half of easy/long-type runs qualify for EF/decoupling — still a
// reasoned choice, not a validated physiological cutoff (same spirit as
// zones.ts's DRIFT_THRESHOLD_PERCENT comment); revisit if it over/under-fires.
const STEADY_CV_THRESHOLD_PERCENT = 9;
const STEADY_MIN_MOVING_SECONDS = 900; // 15 min

export interface SteadinessResult {
  isSteady: boolean;
  cvPercent: number | null;
}

/** Bins velocity_smooth into 60s time buckets (time-weighted avg per bucket) and computes the coefficient of variation across bins. */
export function computeSteadiness(stream: StreamData): SteadinessResult {
  const { time, velocitySmooth } = stream;
  if (!velocitySmooth || velocitySmooth.length === 0) return { isSteady: false, cvPercent: null };
  const n = Math.min(time.length, velocitySmooth.length);

  const binSpeeds: number[] = [];
  let binStart = 0;
  let totalMovingSeconds = 0;
  while (binStart < n - 1) {
    const binEndTime = time[binStart] + BIN_SECONDS;
    let sum = 0;
    let sumDt = 0;
    let i = binStart;
    while (i < n - 1 && time[i] < binEndTime) {
      const dt = Math.max(0, time[i + 1] - time[i]);
      sum += velocitySmooth[i] * dt;
      sumDt += dt;
      i++;
    }
    if (sumDt >= BIN_SECONDS * 0.5) {
      binSpeeds.push(sum / sumDt);
      totalMovingSeconds += sumDt;
    }
    binStart = i > binStart ? i : binStart + 1;
  }

  if (binSpeeds.length < 10) return { isSteady: false, cvPercent: null };

  const mean = binSpeeds.reduce((a, b) => a + b, 0) / binSpeeds.length;
  const variance = binSpeeds.reduce((sum, v) => sum + (v - mean) ** 2, 0) / binSpeeds.length;
  const cvPercent = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : null;

  const isSteady =
    cvPercent != null && cvPercent <= STEADY_CV_THRESHOLD_PERCENT && totalMovingSeconds >= STEADY_MIN_MOVING_SECONDS;
  return { isSteady, cvPercent };
}

/** Higher = better (more graded speed per heartbeat) — matches "rising EF = improving aerobic fitness." */
export function computeEfficiencyFactor(ngpSpeedMps: number, avgHeartrate: number): number | null {
  return avgHeartrate > 0 ? ngpSpeedMps / avgHeartrate : null;
}

export interface DecouplingResult {
  efFirstHalf: number;
  efSecondHalf: number;
  decouplingPercent: number; // positive = EF dropped in 2nd half = aerobic drift
}

function timeWeightedAvg(values: number[], time: number[], startIdx: number, endIdx: number): number | null {
  let sum = 0;
  let sumDt = 0;
  for (let i = startIdx; i < endIdx - 1; i++) {
    const dt = Math.max(0, time[i + 1] - time[i]);
    sum += values[i] * dt;
    sumDt += dt;
  }
  return sumDt > 0 ? sum / sumDt : null;
}

/**
 * Splits by TIME at the halfway point of total elapsed duration (not distance),
 * computes NGP + avg HR for each half, and the % EF change between them — the
 * standard Pa:Hr / TrainingPeaks decoupling test. Callers must gate this to
 * isSteady runs only (interval/race excluded) — decoupling is meaningless on a
 * variable-effort session.
 */
export function computeDecoupling(stream: StreamData, warnings?: string[]): DecouplingResult | null {
  const { time, heartrate } = stream;
  if (!heartrate || heartrate.length === 0) return null;
  const n = Math.min(time.length, heartrate.length);
  if (n < 120) return null;

  const midIdx = Math.floor(n / 2);
  const ngpFirst = computeNGPRange(stream, 0, midIdx, warnings);
  const ngpSecond = computeNGPRange(stream, midIdx, n, warnings);
  if (!ngpFirst || !ngpSecond) return null;

  const hrFirst = timeWeightedAvg(heartrate, time, 0, midIdx);
  const hrSecond = timeWeightedAvg(heartrate, time, midIdx, n);
  if (hrFirst == null || hrSecond == null) return null;

  const efFirstHalf = computeEfficiencyFactor(ngpFirst.ngpSpeedMps, hrFirst);
  const efSecondHalf = computeEfficiencyFactor(ngpSecond.ngpSpeedMps, hrSecond);
  if (efFirstHalf == null || efSecondHalf == null || efFirstHalf === 0) return null;

  return {
    efFirstHalf,
    efSecondHalf,
    decouplingPercent: ((efFirstHalf - efSecondHalf) / efFirstHalf) * 100,
  };
}
