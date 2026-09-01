import type { StravaLap } from "@/lib/strava/types";
import type { StreamData } from "@/lib/coaching/streams";
import { computeAverageGapPace } from "./ngp";

export type LapStructure = "none" | "uniform_auto" | "interval_reps" | "mixed";

export interface RepRow {
  lapIndex: number;
  repIndex: number;
  kind: "work" | "recovery";
  distanceMeters: number;
  durationSeconds: number;
  avgPaceSecPerKm: number | null;
  avgGapPaceSecPerKm: number | null;
  avgHeartrate: number | null;
  maxHeartrate: number | null;
  fadePercentVsFirstRep: number | null;
}

// Noise laps (GPS auto-pause fragments, accidental lap-button taps) — discarded
// before any structure analysis.
const MIN_LAP_DISTANCE_M = 100;
const MIN_LAP_DURATION_S = 20;
const MIN_REAL_LAPS = 3;

// Distance/pace CV thresholds distinguishing genuine interval structure from
// Garmin's uniform auto-laps (e.g. exactly-1km splits on an easy/long run).
// Reasoned priors, not yet calibrated against real lap data — validate during
// the historical backfill (does this fire on real track sessions, and NOT on
// ordinary auto-lapped runs?).
const UNIFORM_DISTANCE_CV_THRESHOLD = 8; // %
const INTERVAL_PACE_CV_THRESHOLD = 15; // %
const FAST_SLOW_BAND_PERCENT = 7; // % off the median pace to call a lap 'fast'/'slow'
const ALTERNATING_MIN_PAIRS = 2;
const ALTERNATING_MIN_SHARE = 0.6; // >=60% of laps must be fast/slow (not neutral)

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / m) * 100;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function detectLapStructure(laps: StravaLap[]): { structure: LapStructure; realLaps: StravaLap[] } {
  const realLaps = laps.filter((l) => l.distance >= MIN_LAP_DISTANCE_M && l.moving_time >= MIN_LAP_DURATION_S);
  if (realLaps.length < MIN_REAL_LAPS) return { structure: "none", realLaps: [] };

  const distances = realLaps.map((l) => l.distance);
  const paces = realLaps.map((l) => l.moving_time / (l.distance / 1000)); // sec/km
  const distanceCv = coefficientOfVariation(distances);
  const paceCv = coefficientOfVariation(paces);

  if (distanceCv < UNIFORM_DISTANCE_CV_THRESHOLD) {
    if (paceCv < UNIFORM_DISTANCE_CV_THRESHOLD) return { structure: "uniform_auto", realLaps };
    if (paceCv >= INTERVAL_PACE_CV_THRESHOLD) return { structure: "interval_reps", realLaps };
    return { structure: "mixed", realLaps };
  }

  // Non-uniform lap distances (manual laps around a structured workout) — classify
  // by whether pace alternates fast/slow across a majority of laps.
  const medianPace = median(paces);
  const bands = paces.map((p) => {
    if (p < medianPace * (1 - FAST_SLOW_BAND_PERCENT / 100)) return "fast";
    if (p > medianPace * (1 + FAST_SLOW_BAND_PERCENT / 100)) return "slow";
    return "neutral";
  });
  const nonNeutralShare = bands.filter((b) => b !== "neutral").length / bands.length;
  let alternatingPairs = 0;
  for (let i = 1; i < bands.length; i++) {
    if (bands[i] !== "neutral" && bands[i - 1] !== "neutral" && bands[i] !== bands[i - 1]) alternatingPairs++;
  }
  if (nonNeutralShare >= ALTERNATING_MIN_SHARE && alternatingPairs >= ALTERNATING_MIN_PAIRS) {
    return { structure: "interval_reps", realLaps };
  }
  return { structure: "mixed", realLaps };
}

/**
 * Builds per-rep rows for 'interval_reps' structure only. 'fast' laps become
 * work reps (1-based repIndex, chronological); everything else becomes a
 * 'recovery' row sharing the preceding work rep's repIndex. fadePercentVsFirstRep
 * is GAP-corrected (via the activity's own stream + lap start/end times) so a
 * hilly later rep doesn't read as "faded" purely from terrain.
 */
export function buildRepRows(laps: StravaLap[], stream: StreamData): RepRow[] {
  const paces = laps.map((l) => l.moving_time / (l.distance / 1000));
  const medianPace = median(paces);

  let elapsedStart = 0;
  const withWindows = laps.map((lap) => {
    const startTime = elapsedStart;
    elapsedStart += lap.elapsed_time;
    return { lap, startTime, endTime: elapsedStart };
  });

  const rows: RepRow[] = [];
  let repIndex = 0;
  let firstRepGapPace: number | null = null;

  for (const { lap, startTime, endTime } of withWindows) {
    const pace = lap.moving_time / (lap.distance / 1000);
    const isWork = pace < medianPace * (1 + FAST_SLOW_BAND_PERCENT / 200); // slightly generous vs. the 'fast' band alone
    if (isWork) repIndex++;

    const startIdx = stream.time.findIndex((t) => t >= startTime);
    const endIdx = stream.time.findIndex((t) => t >= endTime);
    const avgGapPaceSecPerKm =
      startIdx >= 0 && endIdx > startIdx ? computeAverageGapPace(stream, startIdx, endIdx) : null;

    let fadePercentVsFirstRep: number | null = null;
    if (isWork) {
      if (firstRepGapPace == null) firstRepGapPace = avgGapPaceSecPerKm;
      fadePercentVsFirstRep =
        firstRepGapPace != null && avgGapPaceSecPerKm != null
          ? ((avgGapPaceSecPerKm - firstRepGapPace) / firstRepGapPace) * 100
          : null;
    }

    rows.push({
      lapIndex: lap.lap_index,
      repIndex: Math.max(repIndex, 1),
      kind: isWork ? "work" : "recovery",
      distanceMeters: lap.distance,
      durationSeconds: Math.round(lap.moving_time),
      avgPaceSecPerKm: pace,
      avgGapPaceSecPerKm,
      avgHeartrate: lap.average_heartrate ?? null,
      maxHeartrate: lap.max_heartrate ?? null,
      fadePercentVsFirstRep,
    });
  }
  return rows;
}
