import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityStreams, bestPowerEfforts } from "@/lib/db/schema";
import { extractStreamArrays, type StreamData } from "@/lib/coaching/streams";
import { localDateOf } from "@/lib/coaching/matching";
import type { StravaStreamSet } from "@/lib/strava/types";
import { sampleDeltaSeconds } from "./ngp";
import { cleanPowerSeries } from "./power";
import { BEST_EFFORT_DURATIONS_SECONDS } from "./bestEfforts";

/**
 * The mean-maximal POWER curve — the direct analogue of bestEfforts.ts, over the same
 * standard durations so the two curves can be read side by side.
 *
 * Same moving-time discipline as the speed curve: Strava's `time` stream is elapsed, so
 * recording gaps contribute neither time nor work (see sampleDeltaSeconds). Without that,
 * a paused run integrates the last-known wattage across the whole pause and invents work
 * that was never done.
 */

export interface MeanMaximalPower {
  durationSeconds: number;
  watts: number;
}

export function computeMeanMaximalPower(stream: StreamData): MeanMaximalPower[] {
  const raw = stream.watts;
  if (!raw || raw.length === 0) return [];
  const { time } = stream;
  const n = Math.min(raw.length, time.length);
  if (n < 2) return [];

  const { watts } = cleanPowerSeries(raw.slice(0, n));
  // Carry the last good reading across dropped samples, matching computePowerSummary —
  // a brief sensor glitch shouldn't punch a hole in an otherwise valid window.
  const filled: number[] = [];
  let lastGood = 0;
  for (let i = 0; i < n; i++) {
    const w = watts[i];
    if (w != null) lastGood = w;
    filled.push(w ?? lastGood);
  }

  // Parallel cumulative axes: moving time, and work (joules) done within it.
  const movingTime = new Array<number>(n);
  const cumulativeWork = new Array<number>(n);
  movingTime[0] = 0;
  cumulativeWork[0] = 0;
  for (let i = 1; i < n; i++) {
    const dt = sampleDeltaSeconds(time, i - 1);
    movingTime[i] = movingTime[i - 1] + dt;
    cumulativeWork[i] = cumulativeWork[i - 1] + filled[i - 1] * dt;
  }
  const totalMoving = movingTime[n - 1];
  if (totalMoving <= 0) return [];

  const results: MeanMaximalPower[] = [];
  for (const durationSeconds of BEST_EFFORT_DURATIONS_SECONDS) {
    if (totalMoving < durationSeconds) continue;

    let best = 0;
    let start = 0;
    for (let end = 0; end < n; end++) {
      while (start + 1 < end && movingTime[end] - movingTime[start + 1] >= durationSeconds) start++;
      const windowSeconds = movingTime[end] - movingTime[start];
      if (windowSeconds < durationSeconds) continue;
      const avg = (cumulativeWork[end] - cumulativeWork[start]) / windowSeconds;
      if (avg > best) best = avg;
    }
    if (best > 0) results.push({ durationSeconds, watts: best });
  }
  return results;
}

/** Folds one activity's mean-maximal power into the all-time curve. Called from the pipeline. */
export async function updateBestPowerEffortsForActivity(
  activityId: number,
  achievedOn: string,
  stream: StreamData
): Promise<number> {
  const efforts = computeMeanMaximalPower(stream);
  if (efforts.length === 0) return 0;

  const existing = await db.select().from(bestPowerEfforts);
  const bestByDuration = new Map(existing.map((r) => [r.durationSeconds, r]));

  const improved = efforts.filter((e) => {
    const current = bestByDuration.get(e.durationSeconds);
    // Re-metricating the SAME activity refreshes its own row rather than being rejected
    // by the value it itself set last time.
    if (current && current.activityId !== activityId && current.watts >= e.watts) return false;
    return true;
  });
  if (improved.length === 0) return 0;

  for (const effort of improved) {
    const row = {
      durationSeconds: effort.durationSeconds,
      watts: effort.watts,
      activityId,
      achievedOn,
      computedAt: new Date(),
    };
    await db
      .insert(bestPowerEfforts)
      .values(row)
      .onConflictDoUpdate({ target: bestPowerEfforts.durationSeconds, set: row });
  }
  return improved.length;
}

/**
 * Full rescan from cached streams — the repair path, since the incremental update above
 * can only ever raise a best and so can't clear a stale one after a deletion or a change
 * to the artifact filter.
 */
export async function rebuildBestPowerEfforts(): Promise<{ durationsFilled: number; activitiesScanned: number }> {
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

  const best = new Map<number, typeof bestPowerEfforts.$inferInsert>();
  let scanned = 0;
  for (const row of rows) {
    const stream = extractStreamArrays(row.streams as StravaStreamSet);
    if (!stream.watts) continue;
    scanned += 1;
    for (const effort of computeMeanMaximalPower(stream)) {
      const current = best.get(effort.durationSeconds);
      if (current && current.watts >= effort.watts) continue;
      best.set(effort.durationSeconds, {
        durationSeconds: effort.durationSeconds,
        watts: effort.watts,
        activityId: row.activityId,
        achievedOn: localDateOf(row.startDateLocal),
        computedAt: new Date(),
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(bestPowerEfforts);
    if (best.size > 0) await tx.insert(bestPowerEfforts).values([...best.values()]);
  });

  return { durationsFilled: best.size, activitiesScanned: scanned };
}

export interface BestPowerPoint {
  durationSeconds: number;
  watts: number;
  activityId: number;
  activityName: string;
  achievedOn: string;
}

export async function getBestPowerEfforts(): Promise<BestPowerPoint[]> {
  const rows = await db
    .select({
      durationSeconds: bestPowerEfforts.durationSeconds,
      watts: bestPowerEfforts.watts,
      activityId: bestPowerEfforts.activityId,
      activityName: activities.name,
      achievedOn: bestPowerEfforts.achievedOn,
    })
    .from(bestPowerEfforts)
    .innerJoin(activities, eq(bestPowerEfforts.activityId, activities.id))
    .orderBy(asc(bestPowerEfforts.durationSeconds));
  return rows;
}
