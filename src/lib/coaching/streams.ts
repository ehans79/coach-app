import type { StravaStreamSet } from "@/lib/strava/types";

export interface StreamData {
  time: number[]; // seconds since activity start
  distance: number[]; // cumulative meters
  heartrate?: number[];
  cadence?: number[]; // Strava reports single-leg cadence (~75-95 typical) — fine here since
  // every use compares an activity to the athlete's own recent average, never an absolute target.
  velocitySmooth?: number[]; // m/s
  gradeSmoothPercent?: number[]; // Strava's own pre-smoothed grade, e.g. 5.2 = +5.2%
  altitude?: number[]; // meters — display/debugging only, GAP uses gradeSmoothPercent directly
  moving?: boolean[];
}

export function extractStreamArrays(raw: StravaStreamSet): StreamData {
  return {
    time: (raw.time?.data as number[] | undefined) ?? [],
    distance: (raw.distance?.data as number[] | undefined) ?? [],
    heartrate: raw.heartrate?.data as number[] | undefined,
    cadence: raw.cadence?.data as number[] | undefined,
    velocitySmooth: raw.velocity_smooth?.data as number[] | undefined,
    gradeSmoothPercent: raw.grade_smooth?.data as number[] | undefined,
    altitude: raw.altitude?.data as number[] | undefined,
    moving: raw.moving?.data as boolean[] | undefined,
  };
}

export interface CadenceFade {
  firstHalfAvg: number;
  secondHalfAvg: number;
  fadePercent: number; // negative = cadence dropped in the second half
}

/** Splits the cadence stream in half by sample count and compares the two halves. */
export function computeCadenceFade(stream: StreamData): CadenceFade | null {
  const cadence = stream.cadence;
  if (!cadence || cadence.length < 20) return null;

  const mid = Math.floor(cadence.length / 2);
  const firstHalf = cadence.slice(0, mid).filter((v) => v > 0);
  const secondHalf = cadence.slice(mid).filter((v) => v > 0);
  if (firstHalf.length === 0 || secondHalf.length === 0) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const firstHalfAvg = avg(firstHalf);
  const secondHalfAvg = avg(secondHalf);
  return {
    firstHalfAvg,
    secondHalfAvg,
    fadePercent: ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100,
  };
}

export interface PaceFade {
  firstHalfPaceSecPerKm: number;
  secondHalfPaceSecPerKm: number;
  fadePercent: number; // positive = second half was slower
}

/** Splits the run in half by distance and compares average pace between the two halves. */
export function computePaceFade(stream: StreamData): PaceFade | null {
  const { time, distance } = stream;
  const n = Math.min(time.length, distance.length);
  if (n < 20) return null;

  const totalDistance = distance[n - 1];
  if (totalDistance < 1000) return null; // too short to meaningfully split

  const halfDistance = totalDistance / 2;
  const midIdx = distance.findIndex((d) => d >= halfDistance);
  if (midIdx <= 0 || midIdx >= n - 1) return null;

  const firstHalfPaceSecPerKm = ((time[midIdx] - time[0]) / (distance[midIdx] - distance[0])) * 1000;
  const secondHalfPaceSecPerKm =
    ((time[n - 1] - time[midIdx]) / (distance[n - 1] - distance[midIdx])) * 1000;

  return {
    firstHalfPaceSecPerKm,
    secondHalfPaceSecPerKm,
    fadePercent: ((secondHalfPaceSecPerKm - firstHalfPaceSecPerKm) / firstHalfPaceSecPerKm) * 100,
  };
}
