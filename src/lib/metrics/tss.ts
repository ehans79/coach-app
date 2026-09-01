import type { AthleteConstants } from "./constants";
import type { NgpResult } from "./ngp";

export function computeRTss(ngp: NgpResult, constants: AthleteConstants): { rTss: number; intensityFactor: number } {
  const thresholdSpeedMps = 1000 / constants.thresholdPaceSecPerKm;
  // IF as a speed ratio: >1 = faster than threshold. rTSS = duration_s × NGP × IF ÷
  // (threshold_pace × 3600) × 100 with NGP/threshold expressed as speeds — since
  // IF ≡ NGP/threshold by definition, this reduces to duration_s × IF² ÷ 3600 × 100.
  // Sanity check: 3600s exactly at threshold (IF=1) => rTSS = 100 exactly.
  const intensityFactor = ngp.ngpSpeedMps / thresholdSpeedMps;
  const rTss = (ngp.movingDurationSeconds * intensityFactor * intensityFactor) / 3600 * 100;
  return { rTss, intensityFactor };
}

/**
 * hrTSS via a synthetic "1 hour at constant threshold HR" TRIMP baseline, run
 * through the same Banister formula — the HR analog of rTSS's "1hr at threshold
 * pace = 100" calibration. With hrMax=195/restingHr=55/thresholdHr=172:
 * hrRatioThreshold=0.8357, weight≈3.185, baselineTrimp≈159.7 (a concrete
 * sanity-check number to verify against during implementation).
 */
export function computeHrTss(trimp: number, constants: AthleteConstants): { hrTss: number; baselineTrimp: number } {
  const hrReserve = constants.hrMax - constants.restingHr;
  const hrRatioThreshold = hrReserve > 0 ? Math.max(0, (constants.thresholdHr - constants.restingHr) / hrReserve) : 0;
  const weightThreshold = 0.64 * Math.exp(1.92 * hrRatioThreshold);
  const baselineTrimp = 60 * hrRatioThreshold * weightThreshold;
  return { hrTss: baselineTrimp > 0 ? (trimp / baselineTrimp) * 100 : 0, baselineTrimp };
}

export type TssSource = "r_tss" | "hr_tss" | "none";

/**
 * Prefers rTSS (external load, more precise) when NGP was computable on at least
 * 1km of moving distance; falls back to hrTSS; null/'none' if neither computable —
 * matches the reference doc's Stage-1 recommendation (rTSS+NGP primary, hrTSS/TRIMP
 * fallback when pace is unreliable).
 */
export function pickPrimaryTss(
  rTss: number | null,
  hrTss: number | null,
  distanceMeters: number | null
): { primaryTss: number | null; tssSource: TssSource } {
  if (rTss != null && distanceMeters != null && distanceMeters >= 1000) {
    return { primaryTss: rTss, tssSource: "r_tss" };
  }
  if (hrTss != null) return { primaryTss: hrTss, tssSource: "hr_tss" };
  return { primaryTss: null, tssSource: "none" };
}
