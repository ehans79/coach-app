import type { StreamData } from "@/lib/coaching/streams";
import { rollingAverage, sampleDeltaSeconds, ROLL_WINDOW_SECONDS } from "./ngp";

/**
 * Running power from the watch's own wrist-based estimate, carried through Strava's
 * `watts` stream (device_watts=true on every run in this history, recorded by a
 * Forerunner 265).
 *
 * The honesty caveat matters and is repeated at every surface that shows these numbers:
 * this is an ALGORITHMIC ESTIMATE from wrist accelerometry, not a measurement from a
 * foot pod or a power meter. The reference doc (§3, "requires data the app does not
 * have") lists running power as needing a Stryd-type pod and notes there is no open
 * standard for estimating it — Garmin's method is proprietary and unvalidated in public
 * literature. Trend and relative comparison are defensible; absolute watts are not
 * comparable to another athlete's, another device's, or a foot pod's.
 */

// Artifact ceiling. One run in this history reports max_watts 2017, which no runner
// produces and which is a wrist-sensor glitch, not a sprint. A recreational runner's
// genuine instantaneous running power stays well under this even at full sprint, so
// anything above it is dropped rather than allowed to drag a mean-maximal window up.
// A filter for obvious nonsense, not a physiological claim — and the count of dropped
// samples is surfaced rather than hidden, so a stream that is mostly artifact is visible
// as such instead of quietly producing a confident number.
export const MAX_PLAUSIBLE_INSTANT_WATTS = 1000;

export interface CleanedPower {
  /** Per-sample watts with artifacts replaced by null (not zero — a dropout isn't rest). */
  watts: (number | null)[];
  artifactSamples: number;
}

export function cleanPowerSeries(raw: number[]): CleanedPower {
  let artifactSamples = 0;
  const watts = raw.map((w) => {
    if (w == null || !Number.isFinite(w) || w < 0 || w > MAX_PLAUSIBLE_INSTANT_WATTS) {
      // A missing sample is a dropout; a negative or over-ceiling one is impossible.
      // Only the latter counts as an artifact, matching what the UI claims was dropped.
      if (w != null && Number.isFinite(w) && (w < 0 || w > MAX_PLAUSIBLE_INSTANT_WATTS)) artifactSamples += 1;
      return null;
    }
    return w;
  });
  return { watts, artifactSamples };
}

export interface PowerSummary {
  avgWatts: number;
  /** NP-style: 30s rolling average, then 4th-power mean — the same smoothing NGP uses. */
  normalizedWatts: number;
  artifactSamples: number;
  movingSeconds: number;
}

/**
 * Average and Normalized Power over the whole activity.
 *
 * Normalized Power applies Coggan's 30s-rolling-then-fourth-root treatment (reference
 * doc §1/§3), which weights hard surges far above their share of clock time — the same
 * reason NGP exists for pace. Gap-aware via sampleDeltaSeconds, so an auto-paused run
 * doesn't accumulate power across the pause.
 */
export function computePowerSummary(stream: StreamData): PowerSummary | null {
  const raw = stream.watts;
  if (!raw || raw.length === 0) return null;
  const { time } = stream;
  const n = Math.min(raw.length, time.length);
  if (n < 2) return null;

  const { watts, artifactSamples } = cleanPowerSeries(raw.slice(0, n));

  // Interpolate across dropped samples so the rolling window stays continuous; a null
  // left in place would otherwise read as a hole rather than a brief sensor glitch.
  const filled: number[] = [];
  let lastGood = 0;
  for (let i = 0; i < n; i++) {
    const w = watts[i];
    if (w != null) lastGood = w;
    filled.push(w ?? lastGood);
  }

  let sum = 0;
  let sumDt = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = sampleDeltaSeconds(time, i);
    sum += filled[i] * dt;
    sumDt += dt;
  }
  if (sumDt <= 0) return null;

  const rolled = rollingAverage(filled, time.slice(0, n), ROLL_WINDOW_SECONDS);
  let sum4 = 0;
  let sum4Dt = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = sampleDeltaSeconds(time, i);
    sum4 += Math.pow(rolled[i], 4) * dt;
    sum4Dt += dt;
  }

  return {
    avgWatts: sum / sumDt,
    normalizedWatts: sum4Dt > 0 ? Math.pow(sum4 / sum4Dt, 0.25) : sum / sumDt,
    artifactSamples,
    movingSeconds: sumDt,
  };
}
