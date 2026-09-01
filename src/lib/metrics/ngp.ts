import type { StreamData } from "@/lib/coaching/streams";
import { gapMultiplier } from "./grade";

export interface NgpResult {
  ngpSpeedMps: number;
  ngpPaceSecPerKm: number;
  /** Moving time actually included (velocity_smooth >= MIN_MOVING_SPEED_MPS) — feeds rTSS's duration_s. */
  movingDurationSeconds: number;
}

export const ROLL_WINDOW_SECONDS = 30;
const MIN_MOVING_SPEED_MPS = 0.5; // excludes stopped/traffic-light points

/**
 * Strava's `time` stream counts ELAPSED seconds, so an auto-paused run leaves gaps in
 * it — one observed activity here has 1773 samples spanning 3061s with a single 182s
 * jump. Integrating `speed x dt` straight across such a gap invents ~1000m of running
 * that never happened, which inflates NGP, the moving duration rTSS divides by, and the
 * mean-maximal curve alike.
 *
 * Any step longer than this is therefore treated as a recording gap rather than a real
 * sample interval: it contributes neither time nor distance, so the samples either side
 * are simply not adjacent in running time. 10s clears Strava's "smart recording"
 * variable sampling (a few seconds at most while moving) by a comfortable margin while
 * still catching every genuine pause.
 */
export const MAX_SAMPLE_GAP_SECONDS = 10;

/** dt between samples i and i+1, or 0 if that step is a recording gap. */
export function sampleDeltaSeconds(time: number[], i: number): number {
  const dt = time[i + 1] - time[i];
  return dt > 0 && dt <= MAX_SAMPLE_GAP_SECONDS ? dt : 0;
}

/**
 * Per-point graded speed = velocity_smooth × Minetti GAP multiplier(grade_smooth).
 * Flat-grade fallback (multiplier=1 everywhere) when grade_smooth is missing —
 * degrades to unadjusted pace rather than failing outright.
 */
export function computeGradedSpeedSeries(stream: StreamData, warnings?: string[]): number[] | null {
  const { velocitySmooth, gradeSmoothPercent } = stream;
  if (!velocitySmooth || velocitySmooth.length === 0) return null;
  if (!gradeSmoothPercent) {
    warnings?.push("grade_smooth missing — NGP/GAP computed unadjusted (flat-grade assumption)");
  }
  return velocitySmooth.map((v, i) => {
    const gradeFraction = gradeSmoothPercent && gradeSmoothPercent[i] != null ? gradeSmoothPercent[i] / 100 : 0;
    return v * gapMultiplier(gradeFraction);
  });
}

/** 30s time-windowed rolling average via a two-pointer sliding window — robust to irregular sampling. */
export function rollingAverage(values: number[], time: number[], windowSeconds: number): number[] {
  const n = values.length;
  const rolled = new Array(n);
  let lo = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    count++;
    while (time[i] - time[lo] > windowSeconds) {
      sum -= values[lo];
      count--;
      lo++;
    }
    rolled[i] = sum / count;
  }
  return rolled;
}

/**
 * NGP over the [startIdx, endIdx) index range (defaults to the whole stream) — the
 * same function powers whole-run NGP and per-half NGP (for decoupling). 30s rolling
 * average of graded speed, then NP-style 4th-power-mean smoothing over moving points.
 */
export function computeNGPRange(
  stream: StreamData,
  startIdx: number,
  endIdx: number,
  warnings?: string[]
): NgpResult | null {
  const gradedSpeed = computeGradedSpeedSeries(stream, warnings);
  if (!gradedSpeed) {
    warnings?.push("velocity_smooth missing — NGP skipped");
    return null;
  }
  const { time, velocitySmooth } = stream;
  const rangeEnd = Math.min(gradedSpeed.length, time.length, endIdx);
  const n = rangeEnd - startIdx;
  if (n < 60) {
    warnings?.push("range too short for NGP");
    return null;
  }

  const rangeSpeed = gradedSpeed.slice(startIdx, rangeEnd);
  const rangeTime = time.slice(startIdx, rangeEnd);
  const rolled = rollingAverage(rangeSpeed, rangeTime, ROLL_WINDOW_SECONDS);

  let sum4 = 0;
  let sumDt = 0;
  for (let i = 0; i < n - 1; i++) {
    if ((velocitySmooth?.[startIdx + i] ?? 0) < MIN_MOVING_SPEED_MPS) continue;
    const dt = sampleDeltaSeconds(rangeTime, i);
    sum4 += Math.pow(rolled[i], 4) * dt;
    sumDt += dt;
  }
  if (sumDt < 60) {
    warnings?.push("insufficient moving data for NGP");
    return null;
  }

  const ngpSpeedMps = Math.pow(sum4 / sumDt, 0.25);
  return { ngpSpeedMps, ngpPaceSecPerKm: 1000 / ngpSpeedMps, movingDurationSeconds: sumDt };
}

export function computeNGP(stream: StreamData, warnings?: string[]): NgpResult | null {
  return computeNGPRange(stream, 0, stream.time.length, warnings);
}

/**
 * Simple time-weighted average GAP pace over [startIdx, endIdx) — deliberately NOT
 * NGP's 30s-roll+4th-power smoothing, since this feeds per-rep summaries where the
 * segment is already short and effort is already ~uniform (that's what makes it a
 * "rep"); the extra smoothing NGP applies to long variable-effort runs isn't needed.
 */
export function computeAverageGapPace(stream: StreamData, startIdx: number, endIdx: number): number | null {
  const gradedSpeed = computeGradedSpeedSeries(stream);
  if (!gradedSpeed) return null;
  const { time, velocitySmooth } = stream;
  const rangeEnd = Math.min(gradedSpeed.length, time.length, endIdx);
  const n = rangeEnd - startIdx;
  if (n < 2) return null;

  let distanceWeightedSpeed = 0;
  let sumDt = 0;
  for (let i = 0; i < n - 1; i++) {
    if ((velocitySmooth?.[startIdx + i] ?? 0) < MIN_MOVING_SPEED_MPS) continue;
    const dt = sampleDeltaSeconds(time, startIdx + i);
    distanceWeightedSpeed += gradedSpeed[startIdx + i] * dt;
    sumDt += dt;
  }
  if (sumDt === 0) return null;
  const avgGapSpeedMps = distanceWeightedSpeed / sumDt;
  return avgGapSpeedMps > 0 ? 1000 / avgGapSpeedMps : null;
}

/** Time-weighted average grade over the whole stream — a scalar for activity_metrics.avgGradePercent. */
export function computeAvgGradePercent(stream: StreamData): number | null {
  const { gradeSmoothPercent, time } = stream;
  if (!gradeSmoothPercent || gradeSmoothPercent.length === 0) return null;
  const n = Math.min(gradeSmoothPercent.length, time.length);
  let sum = 0;
  let sumDt = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = sampleDeltaSeconds(time, i);
    sum += gradeSmoothPercent[i] * dt;
    sumDt += dt;
  }
  return sumDt > 0 ? sum / sumDt : null;
}
