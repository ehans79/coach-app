import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { criticalPowerFits } from "@/lib/db/schema";
import { getBestPowerEfforts, type BestPowerPoint } from "./bestPowerEfforts";
import {
  leastSquaresFit,
  FIT_MIN_DURATION_SECONDS,
  FIT_MAX_DURATION_SECONDS,
  MIN_FIT_POINTS,
} from "./twoParameterFit";

/**
 * Critical Power / W′ — the power-domain form of the same two-parameter model the Stage-2
 * Critical Speed fit uses, W = CP·t + W′ (reference doc §6). CP is the slope in watts,
 * the asymptote separating heavy from severe intensity; W′ is the intercept in joules,
 * the finite work available above it.
 *
 * Every number here inherits the wrist-power caveat from power.ts: CP is only as good as
 * the watch's proprietary estimate, so it is a self-consistent internal reference, not a
 * figure to compare against a Stryd user's.
 */

// Plausibility rails. A recreational runner's CP sits in the low-to-mid hundreds of
// watts on Garmin's wrist scale; outside this band the fit is being driven by artifact
// or by a curve built entirely from easy running, and "not enough good data" is a more
// honest answer than a number.
const MIN_PLAUSIBLE_CP_WATTS = 50;
const MAX_PLAUSIBLE_CP_WATTS = 600;

export interface CriticalPowerFit {
  criticalPowerWatts: number;
  wPrimeJoules: number;
  rSquared: number;
  points: { durationSeconds: number; watts: number; activityId: number; achievedOn: string }[];
}

export interface CriticalPowerFitResult {
  fit: CriticalPowerFit | null;
  reason: string | null;
}

export function fitCriticalPower(efforts: BestPowerPoint[]): CriticalPowerFitResult {
  const points = efforts
    .filter((e) => e.durationSeconds >= FIT_MIN_DURATION_SECONDS && e.durationSeconds <= FIT_MAX_DURATION_SECONDS)
    .sort((a, b) => a.durationSeconds - b.durationSeconds);

  if (points.length < MIN_FIT_POINTS) {
    return {
      fit: null,
      reason: `Needs best power at ${MIN_FIT_POINTS} durations between 2 and 30 minutes — ${points.length} so far.`,
    };
  }

  // work = CP·t + W′ — the power-domain form of the shared model.
  const linear = leastSquaresFit(
    points.map((p) => p.durationSeconds),
    points.map((p) => p.watts * p.durationSeconds)
  );
  if (!linear) return { fit: null, reason: "Best power efforts don't span enough different durations to fit." };

  const criticalPowerWatts = linear.slope;
  const wPrimeJoules = linear.intercept;

  if (criticalPowerWatts < MIN_PLAUSIBLE_CP_WATTS || criticalPowerWatts > MAX_PLAUSIBLE_CP_WATTS) {
    return { fit: null, reason: "The fitted power came out implausible — the curve needs harder, more varied efforts." };
  }
  // Negative W′ means the short efforts sit BELOW the line the longer ones describe:
  // physiologically impossible, and in practice a sign that no genuinely hard short
  // effort exists in the history yet.
  if (wPrimeJoules <= 0) {
    return {
      fit: null,
      reason: "No hard short efforts yet — the 2-5 minute end of the curve is too easy for the model to fit.",
    };
  }

  return {
    fit: {
      criticalPowerWatts,
      wPrimeJoules,
      rSquared: linear.rSquared,
      points: points.map((p) => ({
        durationSeconds: p.durationSeconds,
        watts: p.watts,
        activityId: p.activityId,
        achievedOn: p.achievedOn,
      })),
    },
    reason: null,
  };
}

/** Predicted sustainable power at duration t: P(t) = CP + W′/t. */
export function predictedPowerAt(
  fit: Pick<CriticalPowerFit, "criticalPowerWatts" | "wPrimeJoules">,
  seconds: number
): number {
  return fit.criticalPowerWatts + fit.wPrimeJoules / seconds;
}

/**
 * Refits CP from the current power curve and stores a new version row. Weekly, alongside
 * the Critical Speed refit — one activity rarely moves the curve.
 */
export async function refitCriticalPower(asOfDateStr?: string): Promise<CriticalPowerFitResult> {
  const asOf = asOfDateStr ?? new Date().toISOString().slice(0, 10);
  const result = fitCriticalPower(await getBestPowerEfforts());
  if (!result.fit) return result;

  const fit = result.fit;
  await db.transaction(async (tx) => {
    await tx.update(criticalPowerFits).set({ isCurrent: false }).where(eq(criticalPowerFits.isCurrent, true));
    await tx.insert(criticalPowerFits).values({
      asOfDate: asOf,
      criticalPowerWatts: fit.criticalPowerWatts,
      wPrimeJoules: fit.wPrimeJoules,
      rSquared: fit.rSquared,
      pointCount: fit.points.length,
      pointsUsed: fit.points,
      isCurrent: true,
    });
  });
  return result;
}

export interface CurrentCriticalPower extends CriticalPowerFit {
  asOfDate: string;
}

export async function getCurrentCriticalPower(): Promise<CurrentCriticalPower | null> {
  const [row] = await db
    .select()
    .from(criticalPowerFits)
    .where(eq(criticalPowerFits.isCurrent, true))
    .orderBy(desc(criticalPowerFits.asOfDate))
    .limit(1);
  if (!row) return null;
  return {
    asOfDate: row.asOfDate,
    criticalPowerWatts: row.criticalPowerWatts,
    wPrimeJoules: row.wPrimeJoules,
    rSquared: row.rSquared ?? 0,
    points: (row.pointsUsed as CriticalPowerFit["points"] | null) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Power zones as % of CP
// ---------------------------------------------------------------------------

/**
 * Reference doc §6 lists the running-power zone bands as: "recovery <~81%, endurance
 * ~81-90%, tempo ~90-100%, threshold ~95-100%, supra-threshold/interval ~101-106%,
 * VO2max ~106-115%+".
 *
 * Those bands overlap, because the doc is summarising several coaches' schemes (Stryd,
 * Palladino, Vance, 80/20) that disagree at the edges rather than one canonical table.
 * Overlapping bands can't bucket a sample, so the tempo/threshold collision is split at
 * 95% — tempo 90-95, threshold 95-100 — which keeps all six of the doc's labels, stays
 * monotonic, and leaves every other boundary exactly where the doc puts it. Noted here
 * rather than silently resolved, since it's an editorial call, not a cited one.
 */
export interface PowerZoneDef {
  zone: number;
  name: string;
  lowPercentOfCp: number;
  highPercentOfCp: number | null; // null = open-ended top zone
}

export const POWER_ZONES: PowerZoneDef[] = [
  { zone: 1, name: "Recovery", lowPercentOfCp: 0, highPercentOfCp: 81 },
  { zone: 2, name: "Endurance", lowPercentOfCp: 81, highPercentOfCp: 90 },
  { zone: 3, name: "Tempo", lowPercentOfCp: 90, highPercentOfCp: 95 },
  { zone: 4, name: "Threshold", lowPercentOfCp: 95, highPercentOfCp: 100 },
  { zone: 5, name: "Interval", lowPercentOfCp: 100, highPercentOfCp: 106 },
  { zone: 6, name: "VO2max+", lowPercentOfCp: 106, highPercentOfCp: null },
];

export interface ResolvedPowerZone extends PowerZoneDef {
  lowWatts: number;
  highWatts: number | null;
}

export function resolvePowerZones(criticalPowerWatts: number): ResolvedPowerZone[] {
  return POWER_ZONES.map((z) => ({
    ...z,
    lowWatts: Math.round((z.lowPercentOfCp / 100) * criticalPowerWatts),
    highWatts: z.highPercentOfCp != null ? Math.round((z.highPercentOfCp / 100) * criticalPowerWatts) : null,
  }));
}

export function bucketizePowerZone(watts: number, criticalPowerWatts: number): number {
  const pct = (watts / criticalPowerWatts) * 100;
  for (const z of POWER_ZONES) {
    if (pct >= z.lowPercentOfCp && (z.highPercentOfCp == null || pct < z.highPercentOfCp)) return z.zone;
  }
  return POWER_ZONES[POWER_ZONES.length - 1].zone;
}

export interface PowerZoneBucket {
  zone: number;
  name: string;
  lowWatts: number;
  highWatts: number | null;
  seconds: number;
  percent: number;
}

/**
 * Time-in-power-zone for one activity, computed on read rather than stored — the same
 * choice activity_metrics makes for GAP/zone series. Because zones are a percentage of a
 * CP that is refit weekly, a stored distribution would freeze an old fit; recomputing
 * means the chart always reflects the CP currently on display beside it.
 */
export function computePowerZoneDistribution(
  watts: (number | null)[],
  time: number[],
  criticalPowerWatts: number,
  sampleDelta: (time: number[], i: number) => number
): PowerZoneBucket[] {
  const resolved = resolvePowerZones(criticalPowerWatts);
  const totals = new Map<number, number>();
  let totalSeconds = 0;
  const n = Math.min(watts.length, time.length);
  for (let i = 0; i < n - 1; i++) {
    const w = watts[i];
    if (w == null) continue;
    const dt = sampleDelta(time, i);
    if (dt <= 0) continue;
    const zone = bucketizePowerZone(w, criticalPowerWatts);
    totals.set(zone, (totals.get(zone) ?? 0) + dt);
    totalSeconds += dt;
  }
  return resolved.map((z) => {
    const seconds = totals.get(z.zone) ?? 0;
    return {
      zone: z.zone,
      name: z.name,
      lowWatts: z.lowWatts,
      highWatts: z.highWatts,
      seconds,
      percent: totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0,
    };
  });
}
