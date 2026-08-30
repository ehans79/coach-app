import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planWorkouts, plans, activities, activityComments } from "@/lib/db/schema";
import { localDateOf, sportsCompatible } from "./matching";

export interface WeekAssessment {
  weekStartDate: string;
  weekEndDate: string;
  sessionsPlanned: number;
  sessionsCompleted: number;
  complianceRatio: number;
  plannedRunVolumeKm: number;
  actualRunVolumeKm: number;
  actualRunDurationSeconds: number;
  longestRunKm: number | null;
  hadZoneDrift: boolean;
  driftedRuns: { date: string; percentAboveTarget: number }[];
  completedSessions: { date: string; name: string; sport: string }[];
  missedSessions: { date: string; name: string; sport: string }[];
  extraActivities: { date: string; name: string; sport: string; distanceKm: number }[];
  avgSufferScore: number | null;
}

/** Assesses how a past week actually went vs. what the active plan prescribed. */
export async function assessWeek(weekStartDate: string, weekEndDate: string): Promise<WeekAssessment> {
  const [activePlan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.isActive, true)).limit(1);

  const workouts = activePlan
    ? await db
        .select()
        .from(planWorkouts)
        .where(
          and(
            eq(planWorkouts.planId, activePlan.id),
            gte(planWorkouts.date, weekStartDate),
            lte(planWorkouts.date, weekEndDate)
          )
        )
    : [];
  const sessionWorkouts = workouts.filter((w) => w.sport !== "rest");

  const rangeStart = new Date(`${weekStartDate}T00:00:00Z`);
  const rangeEnd = new Date(`${weekEndDate}T23:59:59Z`);
  const weekActivities = await db
    .select()
    .from(activities)
    .where(and(gte(activities.startDateLocal, rangeStart), lte(activities.startDateLocal, rangeEnd)));

  const matchedActivityIds = new Set<number>();
  const completedSessions: WeekAssessment["completedSessions"] = [];
  const missedSessions: WeekAssessment["missedSessions"] = [];
  for (const w of sessionWorkouts) {
    const match = weekActivities.find(
      (a) => !matchedActivityIds.has(a.id) && localDateOf(a.startDateLocal) === w.date && sportsCompatible(w.sport, a.sportType)
    );
    if (match) {
      matchedActivityIds.add(match.id);
      completedSessions.push({ date: w.date, name: w.name, sport: w.sport });
    } else {
      missedSessions.push({ date: w.date, name: w.name, sport: w.sport });
    }
  }

  const extraActivities = weekActivities
    .filter((a) => !matchedActivityIds.has(a.id))
    .map((a) => ({
      date: localDateOf(a.startDateLocal),
      name: a.name,
      sport: a.sportType,
      distanceKm: (a.distanceMeters ?? 0) / 1000,
    }));

  const matchedRunActivities = weekActivities.filter(
    (a) => matchedActivityIds.has(a.id) && a.sportType === "Run"
  );
  const plannedRunVolumeKm =
    sessionWorkouts
      .filter((w) => w.sport === "run")
      .reduce((sum, w) => sum + (w.distanceMeters ?? 0), 0) / 1000;
  const actualRunVolumeKm =
    matchedRunActivities.reduce((sum, a) => sum + (a.distanceMeters ?? 0), 0) / 1000;
  const actualRunDurationSeconds = matchedRunActivities.reduce(
    (sum, a) => sum + (a.movingTimeSeconds ?? 0),
    0
  );
  const longestRunKm =
    matchedRunActivities.length > 0
      ? Math.max(...matchedRunActivities.map((a) => (a.distanceMeters ?? 0) / 1000))
      : null;

  const runActivityIds = matchedRunActivities.map((a) => a.id);
  const comments =
    runActivityIds.length > 0
      ? await db
          .select()
          .from(activityComments)
          .where(and(inArray(activityComments.activityId, runActivityIds), eq(activityComments.zoneAdherence, "drifted")))
      : [];
  const driftedRuns = comments
    .map((c) => {
      const facts = c.facts as { zoneAdherence?: { percentAboveTarget?: number } } | null;
      const activity = matchedRunActivities.find((a) => a.id === c.activityId);
      return {
        date: activity ? localDateOf(activity.startDateLocal) : "",
        percentAboveTarget: facts?.zoneAdherence?.percentAboveTarget ?? 0,
      };
    });

  const sufferScores = matchedRunActivities
    .map((a) => a.sufferScore)
    .filter((s): s is number => s != null);
  const avgSufferScore =
    sufferScores.length > 0 ? sufferScores.reduce((a, b) => a + b, 0) / sufferScores.length : null;

  return {
    weekStartDate,
    weekEndDate,
    sessionsPlanned: sessionWorkouts.length,
    sessionsCompleted: matchedActivityIds.size,
    complianceRatio: sessionWorkouts.length > 0 ? matchedActivityIds.size / sessionWorkouts.length : 1,
    plannedRunVolumeKm,
    actualRunVolumeKm,
    actualRunDurationSeconds,
    longestRunKm,
    hadZoneDrift: driftedRuns.length > 0,
    driftedRuns,
    completedSessions,
    missedSessions,
    extraActivities,
    avgSufferScore,
  };
}
