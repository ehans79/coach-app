import { asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activities,
  activityComments,
  activityMetrics,
  activityMetricReps,
  activityStreams,
  dailyLoad,
  planWorkouts,
  planWorkoutExercises,
  plans,
  zoneVersions,
} from "@/lib/db/schema";
import type { PlanDocument, PlanWeekJson } from "@/lib/coaching/plan";
import type { CommentaryFacts } from "@/lib/coaching/commentary";
import { ROLLING_WEEKS } from "@/lib/dashboard/constants";
import { extractStreamArrays } from "@/lib/coaching/streams";
import { computeGradedSpeedSeries } from "@/lib/metrics/ngp";
import type { StravaStreamSet } from "@/lib/strava/types";

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// This week
// ---------------------------------------------------------------------------

export interface PlannedExercise {
  section: "warm_up" | "circuit" | "core_finisher" | "cool_down";
  orderIndex: number;
  exerciseName: string;
  sets: number | null;
  reps: string;
  restBetweenSetsSeconds: number | null;
  rounds: string | null;
  restBetweenRoundsSeconds: number | null;
}

export interface ThisWeekWorkout {
  id: string;
  date: string;
  dayOfWeek: string;
  sport: string;
  name: string;
  humanReadable: string | null;
  distanceMeters: number | null;
  durationMinutes: number | null;
  primaryZone: string | null;
  completed: boolean;
  /** Catalog-backed exercise breakdown for strength workouts generated
   * after the Garmin exercise catalog work — null for older/seeded
   * sessions that predate it (those fall back to parsing `humanReadable`). */
  exercises: PlannedExercise[] | null;
  comment: {
    commentText: string;
    flag: "none" | "watch" | "correct";
    zoneAdherence: "ok" | "drifted" | "na";
  } | null;
}

export interface ThisWeekView {
  weekNumber: number;
  startDate: string;
  endDate: string;
  focus: string;
  isRecoveryWeek: boolean;
  workouts: ThisWeekWorkout[];
  sessionsPlanned: number;
  sessionsCompleted: number;
  planRationale: string | null;
  /** Only set when this plan version's own target week is the one being shown — a
   * verdict generated for a different week would be describing the wrong thing. */
  weekVerdict: string | null;
}

function findCurrentOrNextWeek(weeks: PlanWeekJson[], todayStr: string): PlanWeekJson | undefined {
  return (
    weeks.find((w) => w.startDate <= todayStr && todayStr <= w.endDate) ??
    weeks.find((w) => w.startDate >= todayStr) ??
    weeks[weeks.length - 1]
  );
}

export async function getThisWeekView(): Promise<ThisWeekView | null> {
  const [activePlan] = await db.select().from(plans).where(eq(plans.isActive, true)).limit(1);
  if (!activePlan) return null;

  const planJson = activePlan.planJson as PlanDocument;
  const todayStr = new Date().toISOString().slice(0, 10);
  const week = findCurrentOrNextWeek(planJson.weeks, todayStr);
  if (!week) return null;

  const workoutRows = await db
    .select()
    .from(planWorkouts)
    .where(eq(planWorkouts.planId, activePlan.id));
  const weekWorkouts = workoutRows.filter((w) => w.date >= week.startDate && w.date <= week.endDate);

  const activityRows =
    weekWorkouts.length > 0
      ? await db
          .select({ id: activities.id, planWorkoutId: activities.planWorkoutId })
          .from(activities)
          .where(
            inArray(
              activities.planWorkoutId,
              weekWorkouts.map((w) => w.id)
            )
          )
      : [];
  const activityIdByWorkoutId = new Map(activityRows.map((a) => [a.planWorkoutId as string, a.id]));

  const commentRows =
    activityRows.length > 0
      ? await db
          .select()
          .from(activityComments)
          .where(
            inArray(
              activityComments.activityId,
              activityRows.map((a) => a.id)
            )
          )
      : [];
  const commentByActivityId = new Map(commentRows.map((c) => [c.activityId, c]));

  const strengthWorkoutIds = weekWorkouts.filter((w) => w.sport === "strength").map((w) => w.id);
  const exerciseRows =
    strengthWorkoutIds.length > 0
      ? await db
          .select()
          .from(planWorkoutExercises)
          .where(inArray(planWorkoutExercises.planWorkoutId, strengthWorkoutIds))
      : [];
  const exercisesByWorkoutId = new Map<string, PlannedExercise[]>();
  for (const row of exerciseRows) {
    const list = exercisesByWorkoutId.get(row.planWorkoutId) ?? [];
    list.push({
      section: row.section,
      orderIndex: row.orderIndex,
      exerciseName: row.exerciseName,
      sets: row.sets,
      reps: row.reps,
      restBetweenSetsSeconds: row.restBetweenSetsSeconds,
      rounds: row.rounds,
      restBetweenRoundsSeconds: row.restBetweenRoundsSeconds,
    });
    exercisesByWorkoutId.set(row.planWorkoutId, list);
  }
  for (const list of exercisesByWorkoutId.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  const workouts: ThisWeekWorkout[] = weekWorkouts
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => {
      const activityId = activityIdByWorkoutId.get(w.id);
      const comment = activityId != null ? commentByActivityId.get(activityId) : undefined;
      return {
        id: w.id,
        date: w.date,
        dayOfWeek: w.dayOfWeek,
        sport: w.sport,
        name: w.name,
        humanReadable: w.humanReadable,
        distanceMeters: w.distanceMeters,
        durationMinutes: w.durationMinutes,
        primaryZone: w.primaryZone,
        completed: w.completed,
        exercises: exercisesByWorkoutId.get(w.id) ?? null,
        comment: comment
          ? { commentText: comment.commentText, flag: comment.flag, zoneAdherence: comment.zoneAdherence }
          : null,
      };
    });

  const sessionWorkouts = workouts.filter((w) => w.sport !== "rest");

  const isDisplayingThisVersionsTargetWeek = activePlan.weekStartDate === week.startDate;
  const weekVerdict = isDisplayingThisVersionsTargetWeek
    ? ((activePlan.guardrailsApplied as { weekVerdict?: string } | null)?.weekVerdict ?? null)
    : null;

  return {
    weekNumber: week.weekNumber,
    startDate: week.startDate,
    endDate: week.endDate,
    focus: week.focus,
    isRecoveryWeek: week.isRecoveryWeek,
    workouts,
    sessionsPlanned: sessionWorkouts.length,
    sessionsCompleted: sessionWorkouts.filter((w) => w.completed).length,
    planRationale: activePlan.rationale,
    weekVerdict,
  };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export interface FeedActivity {
  id: number;
  name: string;
  sportType: string;
  startDateLocal: Date;
  distanceMeters: number | null;
  movingTimeSeconds: number | null;
  averageHeartrate: number | null;
  averageCadence: number | null;
  comment: {
    commentText: string;
    flag: "none" | "watch" | "correct";
    zoneAdherence: "ok" | "drifted" | "na";
    weatherTempC: number | null;
    weatherConditions: string | null;
    cadenceDeltaVsRolling: number | null;
  } | null;
}

export async function getActivityFeed(limit = 30): Promise<FeedActivity[]> {
  const rows = await db
    .select()
    .from(activities)
    .orderBy(desc(activities.startDateLocal))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const comments =
    ids.length > 0 ? await db.select().from(activityComments).where(inArray(activityComments.activityId, ids)) : [];
  const commentByActivityId = new Map(comments.map((c) => [c.activityId, c]));

  return rows.map((a) => {
    const c = commentByActivityId.get(a.id);
    return {
      id: a.id,
      name: a.name,
      sportType: a.sportType,
      startDateLocal: a.startDateLocal,
      distanceMeters: a.distanceMeters,
      movingTimeSeconds: a.movingTimeSeconds,
      averageHeartrate: a.averageHeartrate,
      averageCadence: a.averageCadence,
      comment: c
        ? {
            commentText: c.commentText,
            flag: c.flag,
            zoneAdherence: c.zoneAdherence,
            weatherTempC: c.weatherTempC,
            weatherConditions: c.weatherConditions,
            cadenceDeltaVsRolling: c.cadenceDeltaVsRolling,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Activity detail
// ---------------------------------------------------------------------------

export interface ActivityDetail {
  id: number;
  name: string;
  sportType: string;
  startDateLocal: Date;
  distanceMeters: number | null;
  movingTimeSeconds: number | null;
  totalElevationGainMeters: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  averageCadence: number | null;
  sufferScore: number | null;
  comment: {
    commentText: string;
    flag: "none" | "watch" | "correct";
    zoneAdherence: "ok" | "drifted" | "na";
    facts: CommentaryFacts | null;
  } | null;
  metrics: {
    runType: string;
    primaryTss: number | null;
    tssSource: string;
    trimp: number | null;
    intensityFactor: number | null;
    normalizedGradedPaceSecPerKm: number | null;
    isSteady: boolean;
    efficiencyFactor: number | null;
    decouplingPercent: number | null;
  } | null;
}

export async function getActivityDetail(id: number): Promise<ActivityDetail | null> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!activity) return null;

  const [comment] = await db
    .select()
    .from(activityComments)
    .where(eq(activityComments.activityId, id))
    .limit(1);

  const [metrics] = await db.select().from(activityMetrics).where(eq(activityMetrics.activityId, id)).limit(1);

  return {
    id: activity.id,
    name: activity.name,
    sportType: activity.sportType,
    startDateLocal: activity.startDateLocal,
    distanceMeters: activity.distanceMeters,
    movingTimeSeconds: activity.movingTimeSeconds,
    totalElevationGainMeters: activity.totalElevationGainMeters,
    averageHeartrate: activity.averageHeartrate,
    maxHeartrate: activity.maxHeartrate,
    averageCadence: activity.averageCadence,
    sufferScore: activity.sufferScore,
    comment: comment
      ? {
          commentText: comment.commentText,
          flag: comment.flag,
          zoneAdherence: comment.zoneAdherence,
          facts: (comment.facts as CommentaryFacts | null) ?? null,
        }
      : null,
    metrics: metrics
      ? {
          runType: metrics.runType,
          primaryTss: metrics.primaryTss,
          tssSource: metrics.tssSource,
          trimp: metrics.trimp,
          intensityFactor: metrics.intensityFactor,
          normalizedGradedPaceSecPerKm: metrics.normalizedGradedPaceSecPerKm,
          isSteady: metrics.isSteady,
          efficiencyFactor: metrics.efficiencyFactor,
          decouplingPercent: metrics.decouplingPercent,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface WeeklyVolumePoint {
  weekStart: string;
  volumeKm: number;
  longestRunKm: number;
  /** Trailing 4-week average volume, gap weeks (no runs logged) counted as
   * 0 so a break in training actually pulls the average down — a light
   * TrainingPeaks-style "chronic load" proxy computed from this same data,
   * not a new tracked metric. */
  rollingAvgKm: number;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getWeeklyVolumeTrend(): Promise<WeeklyVolumePoint[]> {
  const runs = await db
    .select({ startDateLocal: activities.startDateLocal, distanceMeters: activities.distanceMeters })
    .from(activities)
    .where(eq(activities.sportType, "Run"));

  const byWeek = new Map<string, { volumeM: number; longestM: number }>();
  for (const r of runs) {
    const week = mondayOf(r.startDateLocal.toISOString().slice(0, 10));
    const entry = byWeek.get(week) ?? { volumeM: 0, longestM: 0 };
    entry.volumeM += r.distanceMeters ?? 0;
    entry.longestM = Math.max(entry.longestM, r.distanceMeters ?? 0);
    byWeek.set(week, entry);
  }

  if (byWeek.size === 0) return [];

  const sortedWeeks = [...byWeek.keys()].sort();
  const firstWeek = sortedWeeks[0];
  const lastWeek = sortedWeeks[sortedWeeks.length - 1];

  const points: Omit<WeeklyVolumePoint, "rollingAvgKm">[] = [];
  for (let week = firstWeek; week <= lastWeek; week = addDaysToDateStr(week, 7)) {
    const v = byWeek.get(week) ?? { volumeM: 0, longestM: 0 };
    points.push({
      weekStart: week,
      volumeKm: Math.round((v.volumeM / 1000) * 10) / 10,
      longestRunKm: Math.round((v.longestM / 1000) * 10) / 10,
    });
  }

  return points.map((p, i) => {
    const window = points.slice(Math.max(0, i - ROLLING_WEEKS + 1), i + 1);
    const avg = window.reduce((sum, x) => sum + x.volumeKm, 0) / window.length;
    return { ...p, rollingAvgKm: Math.round(avg * 10) / 10 };
  });
}

export interface ZoneWeekPoint {
  weekStart: string;
  zone1: number;
  zone2: number;
  zone3: number;
  zone4: number;
  zone5: number;
}

export async function getZoneAdherenceTrend(): Promise<ZoneWeekPoint[]> {
  const rows = await db
    .select({
      startDateLocal: activities.startDateLocal,
      facts: activityComments.facts,
    })
    .from(activityComments)
    .innerJoin(activities, eq(activityComments.activityId, activities.id));

  const byWeek = new Map<string, { sums: number[]; count: number }>();
  for (const row of rows) {
    const facts = row.facts as { zoneAdherence?: { distributionPercent?: Record<string, number> } } | null;
    const dist = facts?.zoneAdherence?.distributionPercent;
    if (!dist) continue;

    const week = mondayOf(row.startDateLocal.toISOString().slice(0, 10));
    const entry = byWeek.get(week) ?? { sums: [0, 0, 0, 0, 0], count: 0 };
    for (const [key, pct] of Object.entries(dist)) {
      const zoneNum = Number(key.match(/^zone(\d)/)?.[1]);
      if (zoneNum >= 1 && zoneNum <= 5) entry.sums[zoneNum - 1] += pct;
    }
    entry.count += 1;
    byWeek.set(week, entry);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, { sums, count }]) => ({
      weekStart,
      zone1: Math.round((sums[0] / count) * 10) / 10,
      zone2: Math.round((sums[1] / count) * 10) / 10,
      zone3: Math.round((sums[2] / count) * 10) / 10,
      zone4: Math.round((sums[3] / count) * 10) / 10,
      zone5: Math.round((sums[4] / count) * 10) / 10,
    }));
}

// ---------------------------------------------------------------------------
// Plan history
// ---------------------------------------------------------------------------

export interface PlanHistoryEntry {
  id: string;
  version: number;
  generatedAt: Date;
  weekStartDate: string;
  source: "seed" | "regeneration" | "manual";
  rationale: string | null;
  isActive: boolean;
}

export async function getPlanHistory(): Promise<PlanHistoryEntry[]> {
  const rows = await db.select().from(plans).orderBy(desc(plans.version));
  return rows.map((p) => ({
    id: p.id,
    version: p.version,
    generatedAt: p.generatedAt,
    weekStartDate: p.weekStartDate,
    source: p.source,
    rationale: p.rationale,
    isActive: p.isActive,
  }));
}

// ---------------------------------------------------------------------------
// Zone / pace reference
// ---------------------------------------------------------------------------

export interface ZoneReference {
  asOfDate: string;
  source: string;
  daysSinceValidated: number;
  hrZones: { zone: number; name: string; hrLow: number; hrHigh: number | null }[];
  paceZones: { zone: number; name: string; paceMinPerKm: string }[];
}

export async function getZoneReference(): Promise<ZoneReference | null> {
  const [row] = await db
    .select()
    .from(zoneVersions)
    .where(eq(zoneVersions.isCurrent, true))
    .orderBy(desc(zoneVersions.asOfDate))
    .limit(1);
  if (!row) return null;

  const daysSinceValidated = Math.floor(
    (Date.now() - new Date(`${row.asOfDate}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    asOfDate: row.asOfDate,
    source: row.source,
    daysSinceValidated,
    hrZones: row.hrZones as ZoneReference["hrZones"],
    paceZones: row.paceZones as ZoneReference["paceZones"],
  };
}

export async function getAthleteRunCountBySport(): Promise<{ sportType: string; count: number }[]> {
  const rows = await db
    .select({ sportType: activities.sportType, count: sql<string>`count(*)` })
    .from(activities)
    .groupBy(activities.sportType);
  return rows.map((r) => ({ sportType: r.sportType, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Per-run charts — HR+GAP dual-axis series and interval-rep breakdown
// ---------------------------------------------------------------------------

export interface ActivityHrGapPoint {
  t: number; // seconds since activity start
  hr: number | null;
  gapPaceSecPerKm: number | null;
  half: "first" | "second";
}

const HR_GAP_TARGET_POINTS = 150;

/**
 * Recomputes a downsampled HR+GAP point series from the cached raw streams —
 * deliberately not persisted (see activity_metrics' design notes), so this
 * stays correct even if the GAP formula or grade data changes later. Splits
 * by TIME at the halfway point of total duration, matching the same
 * definition efficiency.ts uses for the decoupling calculation.
 */
export async function getActivityHrGapSeries(activityId: number): Promise<ActivityHrGapPoint[] | null> {
  const [streamRow] = await db
    .select()
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .limit(1);
  if (!streamRow) return null;

  const stream = extractStreamArrays(streamRow.streams as StravaStreamSet);
  const gradedSpeed = computeGradedSpeedSeries(stream);
  if (!gradedSpeed || stream.time.length === 0) return null;

  const n = Math.min(stream.time.length, gradedSpeed.length);
  const totalTime = stream.time[n - 1] - stream.time[0];
  if (totalTime <= 0) return null;
  const midTime = stream.time[0] + totalTime / 2;
  const bucketSeconds = Math.max(1, totalTime / HR_GAP_TARGET_POINTS);

  const buckets = new Map<number, { hrSum: number; hrCount: number; speedSum: number; speedCount: number; t: number }>();
  for (let i = 0; i < n; i++) {
    const bucketIdx = Math.floor((stream.time[i] - stream.time[0]) / bucketSeconds);
    const entry = buckets.get(bucketIdx) ?? { hrSum: 0, hrCount: 0, speedSum: 0, speedCount: 0, t: stream.time[i] };
    if (stream.heartrate?.[i] != null) {
      entry.hrSum += stream.heartrate[i];
      entry.hrCount++;
    }
    if (gradedSpeed[i] > 0) {
      entry.speedSum += gradedSpeed[i];
      entry.speedCount++;
    }
    entry.t = stream.time[i];
    buckets.set(bucketIdx, entry);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => ({
      t: entry.t,
      hr: entry.hrCount > 0 ? Math.round((entry.hrSum / entry.hrCount) * 10) / 10 : null,
      gapPaceSecPerKm: entry.speedCount > 0 ? 1000 / (entry.speedSum / entry.speedCount) : null,
      half: entry.t < midTime ? "first" : "second",
    }));
}

export interface ActivityRepPoint {
  repIndex: number;
  kind: "work" | "recovery";
  distanceKm: number;
  gapPaceSecPerKm: number | null;
  avgHr: number | null;
  fadePercent: number | null;
}

export async function getActivityReps(activityId: number): Promise<ActivityRepPoint[]> {
  const rows = await db
    .select()
    .from(activityMetricReps)
    .where(eq(activityMetricReps.activityId, activityId))
    .orderBy(asc(activityMetricReps.lapIndex));
  return rows.map((r) => ({
    repIndex: r.repIndex,
    kind: r.kind,
    distanceKm: r.distanceMeters / 1000,
    gapPaceSecPerKm: r.avgGapPaceSecPerKm,
    avgHr: r.avgHeartrate,
    fadePercent: r.fadePercentVsFirstRep,
  }));
}

// ---------------------------------------------------------------------------
// Weekly load charts — CTL/ATL/TSB, ACWR, intensity distribution
// ---------------------------------------------------------------------------

export interface DailyLoadPoint {
  date: string;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  acwr: number | null;
}

export async function getDailyLoadTrend(days = 180): Promise<DailyLoadPoint[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);
  return db
    .select({ date: dailyLoad.date, ctl: dailyLoad.ctl, atl: dailyLoad.atl, tsb: dailyLoad.tsb, acwr: dailyLoad.acwr })
    .from(dailyLoad)
    .where(gte(dailyLoad.date, sinceStr))
    .orderBy(asc(dailyLoad.date));
}

export interface WeeklyIntensityPoint {
  weekStart: string;
  lowPercent: number;
  moderatePercent: number;
  highPercent: number;
}

export async function getWeeklyIntensityDistribution(): Promise<WeeklyIntensityPoint[]> {
  const rows = await db
    .select({
      date: dailyLoad.date,
      low: dailyLoad.zoneSecondsLow,
      moderate: dailyLoad.zoneSecondsModerate,
      high: dailyLoad.zoneSecondsHigh,
    })
    .from(dailyLoad);

  const byWeek = new Map<string, { low: number; moderate: number; high: number }>();
  for (const r of rows) {
    const week = mondayOf(r.date);
    const entry = byWeek.get(week) ?? { low: 0, moderate: 0, high: 0 };
    entry.low += r.low;
    entry.moderate += r.moderate;
    entry.high += r.high;
    byWeek.set(week, entry);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, { low, moderate, high }]) => {
      const total = low + moderate + high;
      return {
        weekStart,
        lowPercent: total > 0 ? Math.round((low / total) * 1000) / 10 : 0,
        moderatePercent: total > 0 ? Math.round((moderate / total) * 1000) / 10 : 0,
        highPercent: total > 0 ? Math.round((high / total) * 1000) / 10 : 0,
      };
    });
}
