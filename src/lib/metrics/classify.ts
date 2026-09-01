import type { AthleteConstants } from "./constants";
import type { LapStructure } from "./laps";

export type RunType = "easy" | "tempo" | "long" | "interval" | "race" | "recovery";
export type RunTypeSource = "strava_race" | "strava_long_run" | "heuristic";

const STRAVA_WORKOUT_TYPE_RACE = 1;
const STRAVA_WORKOUT_TYPE_LONG_RUN = 2;

// Calibrated to this athlete's actual training scale, not a generic runner — the
// seeded foundation data's own peak long run is 12km (see return-to-running plan's
// "longestSessions.run: 12"), so a generic 15km/90min floor would systematically
// miss this athlete's real long runs.
const LONG_RUN_MIN_DISTANCE_M = 10000;
const LONG_RUN_MIN_DURATION_S = 4500; // 75 min
const STRAVA_LONG_RUN_MIN_DISTANCE_M = 12000; // sanity floor before trusting workout_type=2 outright

// Tempo requires BOTH pace near threshold AND HR consistent with a genuine
// threshold effort (reference doc §4: "~IF 0.95-1.05; ~85-91% HRmax") — pace
// alone over-fires whenever the single global threshold-pace constant doesn't
// match a given run's actual era of fitness (this constant is provisional and
// applied uniformly across a long, fitness-varying history; a fast-but-easy run
// from a fitter period can look pace-wise "at threshold" against a stale
// constant even though the runner's own HR shows it was an easy effort).
const TEMPO_MIN_PCT_OF_THRESHOLD_PACE = 0.9;
const TEMPO_MIN_HR_PCT = 0.83;
const TEMPO_MIN_DURATION_S = 1200; // Pfitzinger: LT work sustained >=20min
const RECOVERY_MAX_HR_PCT = 0.7;
const RECOVERY_MAX_DURATION_S = 2400; // 40 min

export function classifyRunType(input: {
  workoutType: number | null;
  distanceMeters: number;
  movingTimeSeconds: number;
  avgHeartrate: number | null;
  ngpPaceSecPerKm: number | null; // fallback to raw avg pace by the caller if NGP unavailable
  lapStructure: LapStructure;
  constants: AthleteConstants;
}): { runType: RunType; source: RunTypeSource } {
  if (input.workoutType === STRAVA_WORKOUT_TYPE_RACE) {
    return { runType: "race", source: "strava_race" };
  }
  if (input.workoutType === STRAVA_WORKOUT_TYPE_LONG_RUN && input.distanceMeters >= STRAVA_LONG_RUN_MIN_DISTANCE_M) {
    return { runType: "long", source: "strava_long_run" };
  }

  // A clear alternating-pace lap pattern is a stronger signal than Strava's
  // ambiguous workout_type=3 "Workout" (which doesn't distinguish tempo from interval).
  if (input.lapStructure === "interval_reps") {
    return { runType: "interval", source: "heuristic" };
  }

  if (input.distanceMeters <= 0 || input.movingTimeSeconds <= 0) {
    return { runType: "easy", source: "heuristic" };
  }

  const paceSecPerKm = input.ngpPaceSecPerKm ?? input.movingTimeSeconds / (input.distanceMeters / 1000);
  const pctOfThresholdPace = input.constants.thresholdPaceSecPerKm / paceSecPerKm; // >1 = faster than threshold
  const hrPctOfMax = input.avgHeartrate != null ? input.avgHeartrate / input.constants.hrMax : null;

  if (
    pctOfThresholdPace >= TEMPO_MIN_PCT_OF_THRESHOLD_PACE &&
    hrPctOfMax != null &&
    hrPctOfMax >= TEMPO_MIN_HR_PCT &&
    input.movingTimeSeconds >= TEMPO_MIN_DURATION_S
  ) {
    return { runType: "tempo", source: "heuristic" };
  }
  if (input.distanceMeters >= LONG_RUN_MIN_DISTANCE_M || input.movingTimeSeconds >= LONG_RUN_MIN_DURATION_S) {
    return { runType: "long", source: "heuristic" };
  }
  if (
    hrPctOfMax != null &&
    hrPctOfMax < RECOVERY_MAX_HR_PCT &&
    input.movingTimeSeconds <= RECOVERY_MAX_DURATION_S
  ) {
    return { runType: "recovery", source: "heuristic" };
  }
  return { runType: "easy", source: "heuristic" };
}
