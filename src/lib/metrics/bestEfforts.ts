import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityStreams, bestEfforts } from "@/lib/db/schema";
import { extractStreamArrays, type StreamData } from "@/lib/coaching/streams";
import { localDateOf } from "@/lib/coaching/matching";
import type { StravaStreamSet } from "@/lib/strava/types";
import { computeGradedSpeedSeries, sampleDeltaSeconds } from "./ngp";

/**
 * The standard mean-maximal durations. 2-30 min is the band the Critical Speed fit
 * actually consumes (see criticalSpeed.ts); 60 min is carried for the chart because
 * it's the durability end of the curve an athlete cares about, even though including
 * it in the fit would drag CS down toward a pace that is aerobically limited rather
 * than CS-limited.
 */
export const BEST_EFFORT_DURATIONS_SECONDS = [120, 300, 600, 1200, 1800, 3600] as const;

export interface MeanMaximalEffort {
  durationSeconds: number;
  gradedSpeedMps: number;
  actualSpeedMps: number | null;
}

/**
 * The fastest sustained window of at least each standard duration within one activity —
 * the per-activity contribution to the all-time mean-maximal curve.
 *
 * Runs on a MOVING-time axis, not Strava's elapsed `time` stream. That distinction is
 * not cosmetic: an auto-paused run leaves multi-minute gaps in the elapsed stream, and
 * scanning across them both fabricates distance (last-known velocity x the whole gap)
 * and lets a window's denominator include time the athlete spent standing still. Both
 * failure modes produce a headline "best effort" that never happened. Recording gaps
 * therefore contribute neither time nor distance (see sampleDeltaSeconds), which makes
 * the samples either side adjacent in running time — the same convention behind Strava's
 * own moving time, and behind "fastest 20 minutes of running" as a runner means it.
 *
 * Two-pointer over that axis: for every end sample, walk the start pointer forward to
 * the newest sample still at least `duration` of moving time back, then score the window.
 */
export function computeMeanMaximalEfforts(stream: StreamData): MeanMaximalEffort[] {
  const { time, distance } = stream;
  const gradedSpeed = computeGradedSpeedSeries(stream);
  if (!gradedSpeed || time.length < 2) return [];

  const n = Math.min(time.length, gradedSpeed.length);
  const hasActualDistance = distance.length >= n;

  // Parallel cumulative axes, all gap-aware so any window is one subtraction apart.
  const movingTime = new Array<number>(n);
  const cumulativeGraded = new Array<number>(n);
  const cumulativeActual = new Array<number>(n);
  movingTime[0] = 0;
  cumulativeGraded[0] = 0;
  cumulativeActual[0] = 0;
  for (let i = 1; i < n; i++) {
    const dt = sampleDeltaSeconds(time, i - 1);
    movingTime[i] = movingTime[i - 1] + dt;
    cumulativeGraded[i] = cumulativeGraded[i - 1] + gradedSpeed[i - 1] * dt;
    // Dropped alongside the time when the step is a gap — GPS drift across a pause
    // isn't distance run, and counting it while not counting the time would be worse.
    const actualDelta = hasActualDistance && dt > 0 ? Math.max(0, distance[i] - distance[i - 1]) : 0;
    cumulativeActual[i] = cumulativeActual[i - 1] + actualDelta;
  }
  const totalMoving = movingTime[n - 1];
  if (totalMoving <= 0) return [];

  const results: MeanMaximalEffort[] = [];
  for (const durationSeconds of BEST_EFFORT_DURATIONS_SECONDS) {
    if (totalMoving < durationSeconds) continue;

    let bestGradedSpeed = 0;
    let bestActualSpeed: number | null = null;
    let start = 0;
    for (let end = 0; end < n; end++) {
      // Advance to the tightest window that still spans at least `durationSeconds`.
      while (start + 1 < end && movingTime[end] - movingTime[start + 1] >= durationSeconds) start++;
      const windowSeconds = movingTime[end] - movingTime[start];
      if (windowSeconds < durationSeconds) continue;

      const speed = (cumulativeGraded[end] - cumulativeGraded[start]) / windowSeconds;
      if (speed > bestGradedSpeed) {
        bestGradedSpeed = speed;
        bestActualSpeed = hasActualDistance
          ? (cumulativeActual[end] - cumulativeActual[start]) / windowSeconds
          : null;
      }
    }

    if (bestGradedSpeed > 0) {
      results.push({ durationSeconds, gradedSpeedMps: bestGradedSpeed, actualSpeedMps: bestActualSpeed });
    }
  }
  return results;
}

/**
 * Folds one activity's mean-maximal efforts into the all-time best_efforts table,
 * keeping whichever is faster per duration. Called from the metrics pipeline, so the
 * curve stays current on every sync with no extra Strava calls — only the CS FIT is
 * deferred to the weekly job.
 */
export async function updateBestEffortsForActivity(
  activityId: number,
  achievedOn: string,
  stream: StreamData
): Promise<number> {
  const efforts = computeMeanMaximalEfforts(stream);
  if (efforts.length === 0) return 0;

  const existing = await db.select().from(bestEfforts);
  const bestByDuration = new Map(existing.map((r) => [r.durationSeconds, r]));

  const improved = efforts.filter((e) => {
    const current = bestByDuration.get(e.durationSeconds);
    // Re-metricating the SAME activity should refresh its own row rather than be
    // rejected by the value it itself set last time.
    if (current && current.activityId !== activityId && current.gradedSpeedMps >= e.gradedSpeedMps) return false;
    return true;
  });
  if (improved.length === 0) return 0;

  for (const effort of improved) {
    const row = {
      durationSeconds: effort.durationSeconds,
      gradedSpeedMps: effort.gradedSpeedMps,
      actualSpeedMps: effort.actualSpeedMps,
      activityId,
      achievedOn,
      computedAt: new Date(),
    };
    await db.insert(bestEfforts).values(row).onConflictDoUpdate({ target: bestEfforts.durationSeconds, set: row });
  }
  return improved.length;
}

/**
 * Full rescan of every cached run stream, replacing the table wholesale. The
 * incremental path above can only ever raise a best, so this is what repairs the curve
 * after a historical backfill, after an activity is deleted (its rows cascade away and
 * leave a hole), or after a change to the grade-adjustment maths.
 */
export async function rebuildBestEfforts(): Promise<{ durationsFilled: number; activitiesScanned: number }> {
  const rows = await db
    .select({
      activityId: activities.id,
      startDateLocal: activities.startDateLocal,
      streams: activityStreams.streams,
    })
    .from(activityStreams)
    .innerJoin(activities, eq(activityStreams.activityId, activities.id))
    .where(eq(activities.sportType, "Run"))
    .orderBy(asc(activities.startDateLocal));

  const best = new Map<number, typeof bestEfforts.$inferInsert>();
  for (const row of rows) {
    const stream = extractStreamArrays(row.streams as StravaStreamSet);
    for (const effort of computeMeanMaximalEfforts(stream)) {
      const current = best.get(effort.durationSeconds);
      if (current && current.gradedSpeedMps >= effort.gradedSpeedMps) continue;
      best.set(effort.durationSeconds, {
        durationSeconds: effort.durationSeconds,
        gradedSpeedMps: effort.gradedSpeedMps,
        actualSpeedMps: effort.actualSpeedMps,
        activityId: row.activityId,
        achievedOn: localDateOf(row.startDateLocal),
        computedAt: new Date(),
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(bestEfforts);
    if (best.size > 0) await tx.insert(bestEfforts).values([...best.values()]);
  });

  return { durationsFilled: best.size, activitiesScanned: rows.length };
}

export interface BestEffortPoint {
  durationSeconds: number;
  gradedSpeedMps: number;
  gradedPaceSecPerKm: number;
  actualPaceSecPerKm: number | null;
  activityId: number;
  activityName: string;
  achievedOn: string;
}

export async function getBestEfforts(): Promise<BestEffortPoint[]> {
  const rows = await db
    .select({
      durationSeconds: bestEfforts.durationSeconds,
      gradedSpeedMps: bestEfforts.gradedSpeedMps,
      actualSpeedMps: bestEfforts.actualSpeedMps,
      activityId: bestEfforts.activityId,
      activityName: activities.name,
      achievedOn: bestEfforts.achievedOn,
    })
    .from(bestEfforts)
    .innerJoin(activities, eq(bestEfforts.activityId, activities.id))
    .orderBy(asc(bestEfforts.durationSeconds));

  return rows.map((r) => ({
    durationSeconds: r.durationSeconds,
    gradedSpeedMps: r.gradedSpeedMps,
    gradedPaceSecPerKm: 1000 / r.gradedSpeedMps,
    actualPaceSecPerKm: r.actualSpeedMps && r.actualSpeedMps > 0 ? 1000 / r.actualSpeedMps : null,
    activityId: r.activityId,
    activityName: r.activityName,
    achievedOn: r.achievedOn,
  }));
}
