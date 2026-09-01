// Daniels-Gilbert VDOT model — the two-equation oxygen-cost / %VO2max pair from
// Daniels & Gilbert, *Oxygen Power* (1979), as summarised in
// docs/sports-science-reference.md §1. VDOT is an "effective VO2max" that folds in
// running economy: the VO2 demand of the velocity actually held, divided by the
// fraction of VO2max a runner can hold for that long.
//
// Sanity check against the seeded athlete_constants row (scripts/seed.ts), which was
// derived by hand from a 35:00 5K: computeVdot(5000, 2100) => 25.57 (seed says 25.6)
// and thresholdPaceFromVdot(25.6) => 435 s/km (seed says 432 s/km, 7:12/km). Both
// reproduce, which is what makes the Stage-1 -> Stage-2 threshold handover a
// refinement of the same model rather than a switch to a different one.

/** Oxygen cost (ml/kg/min) of running at `velocityMetersPerMin`. */
export function oxygenCost(velocityMetersPerMin: number): number {
  const v = velocityMetersPerMin;
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for `durationMinutes` (>1 for very short efforts). */
export function sustainableFraction(durationMinutes: number): number {
  const t = durationMinutes;
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
}

/**
 * Inverse of oxygenCost — the velocity (m/min) whose oxygen cost is `vo2`. The
 * quadratic has one positive root in the range that matters; the negative root is a
 * mathematical artefact of extending the polynomial below zero velocity.
 */
export function velocityForOxygenCost(vo2: number): number | null {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const velocity = (-b + Math.sqrt(discriminant)) / (2 * a);
  return velocity > 0 ? velocity : null;
}

// Validity window for the %VO2max curve. Daniels' own tables run from ~1500m to the
// marathon; below ~5 min the anaerobic contribution the model doesn't carry starts to
// dominate, and beyond ~4 hours fuelling/thermoregulation limit the result rather than
// aerobic capacity. Efforts outside this get no VDOT rather than a confidently wrong one.
export const VDOT_MIN_DURATION_SECONDS = 300; // 5 min
export const VDOT_MAX_DURATION_SECONDS = 4 * 3600;
export const VDOT_MIN_DISTANCE_METERS = 1500;

/**
 * VDOT for a sustained effort of `distanceMeters` in `durationSeconds`. Assumes the
 * effort was genuinely near-maximal — that assumption is the caller's job to enforce
 * (see qualifyingEfforts.ts); a hard-but-not-maximal run run through this understates
 * fitness rather than erroring.
 */
export function computeVdot(distanceMeters: number, durationSeconds: number): number | null {
  if (
    distanceMeters < VDOT_MIN_DISTANCE_METERS ||
    durationSeconds < VDOT_MIN_DURATION_SECONDS ||
    durationSeconds > VDOT_MAX_DURATION_SECONDS
  ) {
    return null;
  }
  const durationMinutes = durationSeconds / 60;
  const velocityMetersPerMin = distanceMeters / durationMinutes;
  const vo2 = oxygenCost(velocityMetersPerMin);
  const fraction = sustainableFraction(durationMinutes);
  if (fraction <= 0 || vo2 <= 0) return null;
  return vo2 / fraction;
}

/** Pace (sec/km) the athlete holds when running at `fraction` of their VDOT. */
export function paceForVdotFraction(vdot: number, fraction: number): number | null {
  const velocityMetersPerMin = velocityForOxygenCost(vdot * fraction);
  if (velocityMetersPerMin == null || velocityMetersPerMin <= 0) return null;
  return (1000 / velocityMetersPerMin) * 60;
}

// Daniels' five training intensities as %VO2max bands (Daniels' Running Formula 4th
// ed.; the reference doc's §1 summary quotes the same anchors). The FAST end of each
// band is its high fraction, the SLOW end its low fraction.
export interface DanielsPaceBand {
  key: "E" | "M" | "T" | "I" | "R";
  zone: number;
  name: string;
  lowFraction: number;
  highFraction: number;
  purpose: string;
}

export const DANIELS_PACE_BANDS: DanielsPaceBand[] = [
  {
    key: "E",
    zone: 1,
    name: "Easy",
    lowFraction: 0.59,
    highFraction: 0.74,
    purpose: "Aerobic base and recovery — ~65-79% HRmax. The bulk of weekly volume.",
  },
  {
    key: "M",
    zone: 2,
    name: "Marathon",
    lowFraction: 0.75,
    highFraction: 0.84,
    purpose: "Steady race-pace work for a marathon or long steady segment.",
  },
  {
    key: "T",
    zone: 3,
    name: "Threshold",
    lowFraction: 0.83,
    highFraction: 0.88,
    purpose: '"Comfortably hard" — roughly one-hour race pace. Tempo runs and cruise intervals.',
  },
  {
    key: "I",
    zone: 4,
    name: "Interval",
    lowFraction: 0.95,
    highFraction: 1.0,
    purpose: "At or near VO2max — 3-5 min reps to raise aerobic ceiling.",
  },
  {
    key: "R",
    zone: 5,
    name: "Repetition",
    lowFraction: 1.05,
    highFraction: 1.1,
    purpose: "Speed and economy — short, fast reps with full recovery.",
  },
];

// Daniels anchors Threshold at ~88% VO2max ("comfortably hard", ~1hr race pace) — the
// same definition of "threshold pace" that rTSS's 1hr-at-threshold-=-100 calibration
// assumes, which is exactly why the VDOT-derived T pace can be handed straight to the
// Stage-1 load engine as its threshold constant.
export const THRESHOLD_VO2_FRACTION = 0.88;

export function thresholdPaceFromVdot(vdot: number): number | null {
  return paceForVdotFraction(vdot, THRESHOLD_VO2_FRACTION);
}

export interface DanielsTrainingPace {
  key: DanielsPaceBand["key"];
  zone: number;
  name: string;
  purpose: string;
  /** Fast end of the band, sec/km. */
  fastSecPerKm: number;
  /** Slow end of the band, sec/km. */
  slowSecPerKm: number;
}

/** The five Daniels training paces for a given VDOT — the athlete's active pace zones. */
export function danielsTrainingPaces(vdot: number): DanielsTrainingPace[] {
  const paces: DanielsTrainingPace[] = [];
  for (const band of DANIELS_PACE_BANDS) {
    const fast = paceForVdotFraction(vdot, band.highFraction);
    const slow = paceForVdotFraction(vdot, band.lowFraction);
    if (fast == null || slow == null) continue;
    paces.push({
      key: band.key,
      zone: band.zone,
      name: band.name,
      purpose: band.purpose,
      fastSecPerKm: fast,
      slowSecPerKm: slow,
    });
  }
  return paces;
}
