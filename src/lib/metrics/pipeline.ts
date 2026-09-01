import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityMetrics, activityMetricReps } from "@/lib/db/schema";
import { getOrFetchStreams } from "@/lib/sync/activities";
import { getActivityLaps } from "@/lib/strava/client";
import type { StravaStreamSet, StravaLap } from "@/lib/strava/types";
import { extractStreamArrays } from "@/lib/coaching/streams";
import { getCurrentHrZones, computeZoneTimeDistribution } from "@/lib/coaching/zones";
import { getCurrentAthleteConstants } from "./constants";
import { computeNGP, computeAverageGapPace, computeAvgGradePercent } from "./ngp";
import { computeTrimp } from "./trimp";
import { computeRTss, computeHrTss, pickPrimaryTss } from "./tss";
import { computeSteadiness, computeEfficiencyFactor, computeDecoupling } from "./efficiency";
import { detectLapStructure, buildRepRows } from "./laps";
import { classifyRunType, type RunType } from "./classify";

function bucketZoneSeconds(distribution: { zone: number; seconds: number }[]) {
  let low = 0;
  let moderate = 0;
  let high = 0;
  for (const bucket of distribution) {
    if (bucket.zone <= 2) low += bucket.seconds;
    else if (bucket.zone === 3) moderate += bucket.seconds;
    else high += bucket.seconds;
  }
  return { low, moderate, high };
}

/**
 * Computes and persists all deterministic sports-science metrics for one Run
 * activity — v1 scope is runs only, mirroring generateCommentaryForActivity's
 * early-return pattern. Runs BEFORE commentary generation at every call site so
 * commentary can read the freshly-computed facts. Safe to call more than once
 * (upserts activity_metrics, replaces activity_metric_reps).
 */
export async function computeMetricsForActivity(activityId: number): Promise<void> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, activityId)).limit(1);
  if (!activity) throw new Error(`Activity ${activityId} not found`);
  if (activity.sportType !== "Run") return;

  const warnings: string[] = [];
  const streamsRaw = (await getOrFetchStreams(activityId)) as StravaStreamSet;
  const stream = extractStreamArrays(streamsRaw);
  const constants = await getCurrentAthleteConstants();
  const hrZones = await getCurrentHrZones();

  const ngp = computeNGP(stream, warnings);
  const trimp = stream.heartrate ? computeTrimp(stream.heartrate, stream.time, constants) : null;
  const { rTss, intensityFactor } = ngp ? computeRTss(ngp, constants) : { rTss: null, intensityFactor: null };
  const { hrTss } = trimp != null ? computeHrTss(trimp, constants) : { hrTss: null };
  const { primaryTss, tssSource } = pickPrimaryTss(rTss, hrTss, activity.distanceMeters);

  const hasHrZoneData = !!stream.heartrate && stream.heartrate.length > 0;
  const zoneDistribution = hasHrZoneData
    ? computeZoneTimeDistribution(stream.heartrate!, stream.time, hrZones)
    : [];
  const { low, moderate, high } = bucketZoneSeconds(zoneDistribution);

  let laps: StravaLap[] = [];
  try {
    laps = await getActivityLaps(activityId);
  } catch (err) {
    warnings.push(`laps fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { structure: lapStructure, realLaps } = detectLapStructure(laps);
  const repRows = lapStructure === "interval_reps" ? buildRepRows(realLaps, stream) : [];

  const gapAvgPaceSecPerKm = computeAverageGapPace(stream, 0, stream.time.length);
  const avgGradePercent = computeAvgGradePercent(stream);

  const { runType, source: runTypeSource } = classifyRunType({
    workoutType: activity.workoutType,
    distanceMeters: activity.distanceMeters ?? 0,
    movingTimeSeconds: activity.movingTimeSeconds ?? 0,
    avgHeartrate: activity.averageHeartrate,
    ngpPaceSecPerKm: ngp?.ngpPaceSecPerKm ?? null,
    lapStructure,
    constants,
  });

  const steadiness = computeSteadiness(stream);
  const isSteady = steadiness.isSteady && !(["interval", "race"] as RunType[]).includes(runType);

  const decoupling = isSteady && stream.heartrate ? computeDecoupling(stream, warnings) : null;
  const efficiencyFactor =
    isSteady && ngp && activity.averageHeartrate ? computeEfficiencyFactor(ngp.ngpSpeedMps, activity.averageHeartrate) : null;

  const metricsRow = {
    activityId,
    runType,
    runTypeSource,
    lapStructure,
    isSteady,
    paceCvPercent: steadiness.cvPercent,
    gapAvgPaceSecPerKm,
    normalizedGradedPaceSecPerKm: ngp?.ngpPaceSecPerKm ?? null,
    ngpMovingDurationSeconds: ngp?.movingDurationSeconds ?? null,
    avgGradePercent,
    trimp,
    rTss,
    hrTss,
    primaryTss,
    tssSource,
    intensityFactor,
    efficiencyFactor,
    decouplingPercent: decoupling?.decouplingPercent ?? null,
    zoneSecondsLow: hasHrZoneData ? low : null,
    zoneSecondsModerate: hasHrZoneData ? moderate : null,
    zoneSecondsHigh: hasHrZoneData ? high : null,
    constantsId: constants.id,
    warnings,
    computedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(activityMetrics)
      .values(metricsRow)
      .onConflictDoUpdate({ target: activityMetrics.activityId, set: metricsRow });

    await tx.delete(activityMetricReps).where(eq(activityMetricReps.activityId, activityId));
    if (repRows.length > 0) {
      await tx.insert(activityMetricReps).values(repRows.map((r) => ({ ...r, activityId })));
    }
  });
}

// Matches FALLBACK_POLL_LOOKBACK_DAYS in commentary.ts — bounds the hourly/webhook
// fallback catch-up to recent activities, not the entire backfilled history.
const METRICS_LOOKBACK_DAYS = 3;

/** Recent Run activities with no computed metrics yet. */
export async function findUnmetricatedRunActivityIds(): Promise<number[]> {
  const since = new Date(Date.now() - METRICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: activities.id })
    .from(activities)
    .leftJoin(activityMetrics, eq(activityMetrics.activityId, activities.id))
    .where(
      and(eq(activities.sportType, "Run"), isNull(activityMetrics.activityId), gte(activities.startDate, since))
    );
  return rows.map((r) => r.id);
}
