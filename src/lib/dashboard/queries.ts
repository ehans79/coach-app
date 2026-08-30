import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityComments, planWorkouts, plans, zoneVersions } from "@/lib/db/schema";
import type { PlanDocument, PlanWeekJson } from "@/lib/coaching/plan";
import type { CommentaryFacts } from "@/lib/coaching/commentary";

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

export interface ThisWeekWorkout {
  id: string;
  date: string;
  dayOfWeek: string;
  sport: string;
  name: string;
  humanReadable: string | null;
  distanceMeters: number | null;
  durationMinutes: number | null;
  completed: boolean;
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
        completed: w.completed,
        comment: comment
          ? { commentText: comment.commentText, flag: comment.flag, zoneAdherence: comment.zoneAdherence }
          : null,
      };
    });

  const sessionWorkouts = workouts.filter((w) => w.sport !== "rest");

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
}

export async function getActivityDetail(id: number): Promise<ActivityDetail | null> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!activity) return null;

  const [comment] = await db
    .select()
    .from(activityComments)
    .where(eq(activityComments.activityId, id))
    .limit(1);

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
  };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface WeeklyVolumePoint {
  weekStart: string;
  volumeKm: number;
  longestRunKm: number;
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

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, v]) => ({
      weekStart,
      volumeKm: Math.round((v.volumeM / 1000) * 10) / 10,
      longestRunKm: Math.round((v.longestM / 1000) * 10) / 10,
    }));
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
