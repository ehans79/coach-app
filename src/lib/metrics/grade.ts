// Minetti AE et al. (2002), "Energy cost of walking and running at extreme
// uphill and downhill slopes," J Appl Physiol 93(3):1039-1046. Valid -45%..+45%
// grade; clamp outside that range rather than extrapolate the polynomial, which
// diverges badly beyond it.
const GRADE_MIN = -0.45;
const GRADE_MAX = 0.45;

/** g = grade as a fraction (0.05 = +5%). Returns energy cost in J/kg/m. */
export function minettiCostOfRunning(gradeFraction: number): number {
  const g = Math.min(GRADE_MAX, Math.max(GRADE_MIN, gradeFraction));
  const g2 = g * g;
  const g3 = g2 * g;
  const g4 = g3 * g;
  const g5 = g4 * g;
  return 155.4 * g5 - 30.4 * g4 - 43.3 * g3 + 46.3 * g2 + 19.5 * g + 3.6;
}

const FLAT_COST = minettiCostOfRunning(0); // 3.6 J/kg/m

/**
 * GAP multiplier = C(g)/C(0). >1 uphill (equivalent flat pace is FASTER than
 * actual pace — you're working harder than raw pace suggests), <1 downhill.
 */
export function gapMultiplier(gradeFraction: number): number {
  return minettiCostOfRunning(gradeFraction) / FLAT_COST;
}
