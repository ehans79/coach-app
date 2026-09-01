/**
 * The two-parameter hyperbolic model, shared by Critical Speed and Critical Power.
 *
 * Both are the same model in different units (Monod & Scherrer 1965; Jones & Vanhatalo
 * 2017, reference doc §2/§6). In linear form the cumulative quantity achieved over a
 * maximal effort is linear in its duration:
 *
 *   distance = CS·t + D'     (speed domain — metres, m/s, metres)
 *   work     = CP·t + W'     (power domain — joules, watts, joules)
 *
 * so the slope is the sustainable asymptote and the intercept the finite reserve
 * available above it. Keeping one implementation means the two curves can't silently
 * drift apart in fit window, point count or goodness-of-fit definition — the whole
 * point of showing them side by side is that they're the same analysis.
 */

// Fit window, shared by both domains. The classic protocol uses maximal efforts of
// roughly 2-15 min, where the hyperbola is well-conditioned: shorter efforts are
// dominated by the finite reserve and longer ones by substrate and thermoregulation
// rather than the asymptote, and both bend the line. 30 min is kept as the upper bound
// because with a sparse history dropping to 20 often leaves too few points to fit at
// all; 60 min is deliberately excluded even though the curve carries it for display.
export const FIT_MIN_DURATION_SECONDS = 120;
export const FIT_MAX_DURATION_SECONDS = 1800;

// Two points define a line but say nothing about whether the model fits. Three is the
// minimum at which r² carries any information.
export const MIN_FIT_POINTS = 3;

export interface LinearFit {
  /** Sustainable asymptote — CS in m/s, or CP in watts. */
  slope: number;
  /** Finite reserve above it — D' in metres, or W' in joules. */
  intercept: number;
  rSquared: number;
}

/**
 * Ordinary least squares of `ys` on `xs`. Returns null when the x values don't vary
 * (a vertical fit is undefined, not merely a bad one).
 *
 * A caveat worth carrying to any caller that displays r²: it is computed on the
 * CUMULATIVE quantity, which grows with duration, so the long-duration points dominate
 * the variance and r² reads flatteringly high even when the model misses badly at the
 * short end. It's the conventional figure for this model, but it is a statement about
 * the line, not about how well the athlete's short efforts are described.
 */
export function leastSquaresFit(xs: number[], ys: number[]): LinearFit | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < n; i++) {
    covariance += (xs[i] - meanX) * (ys[i] - meanY);
    varianceX += (xs[i] - meanX) ** 2;
  }
  if (varianceX === 0) return null;

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residualSumSquares = 0;
  let totalSumSquares = 0;
  for (let i = 0; i < n; i++) {
    residualSumSquares += (ys[i] - (slope * xs[i] + intercept)) ** 2;
    totalSumSquares += (ys[i] - meanY) ** 2;
  }
  const rSquared = totalSumSquares > 0 ? 1 - residualSumSquares / totalSumSquares : 1;

  return { slope, intercept, rSquared };
}
