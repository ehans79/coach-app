import type { AthleteConstants } from "./constants";
import { sampleDeltaSeconds } from "./ngp";

/**
 * Banister TRIMP (male weighting — Edu). Per-sample:
 *   ΔHRratio = (HR − restingHr) / (HRmax − restingHr)
 *   weight = 0.64 · e^(1.92 · ΔHRratio)
 *   TRIMP += dt_min × ΔHRratio × weight
 * Not gated by "moving" — a stopped-but-elevated HR still reflects real physiological
 * load, unlike pace/speed which is meaningless while stopped. A recording GAP is a
 * different thing though (see sampleDeltaSeconds): there the watch logged nothing at
 * all, so charging the whole gap at the last-seen HR would be inventing load.
 */
export function computeTrimp(heartrate: number[], time: number[], constants: AthleteConstants): number | null {
  const n = Math.min(heartrate.length, time.length);
  if (n < 2) return null;
  const hrReserve = constants.hrMax - constants.restingHr;
  if (hrReserve <= 0) return null;

  let trimp = 0;
  for (let i = 0; i < n - 1; i++) {
    const dtMin = sampleDeltaSeconds(time, i) / 60;
    const hrRatio = Math.max(0, (heartrate[i] - constants.restingHr) / hrReserve);
    const weight = 0.64 * Math.exp(1.92 * hrRatio);
    trimp += dtMin * hrRatio * weight;
  }
  return trimp;
}
