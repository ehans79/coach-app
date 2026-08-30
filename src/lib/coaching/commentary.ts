import { and, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityComments } from "@/lib/db/schema";
import { getOrFetchStreams } from "@/lib/sync/activities";
import type { StravaStreamSet } from "@/lib/strava/types";
import { getCurrentHrZones, computeZoneTimeDistribution, assessZoneAdherence } from "./zones";
import { extractStreamArrays, computeCadenceFade, computePaceFade } from "./streams";
import { getRollingAverageCadence } from "./history";
import { findMatchingPlanWorkout } from "./matching";
import { getWeatherAtActivityStart, type WeatherSnapshot } from "@/lib/weather/openMeteo";
import { generateText } from "@/lib/llm/anthropic";
import { formatKm, formatDuration, formatPace, formatTempC } from "@/lib/format";
import type { ZoneAdherenceAssessment } from "./zones";
import type { CadenceFade, PaceFade } from "./streams";

type Flag = "none" | "watch" | "correct";

function determineFlag(
  zoneAssessment: ZoneAdherenceAssessment,
  cadenceDelta: number | null,
  cadenceFade: CadenceFade | null
): Flag {
  if (zoneAssessment.adherence === "drifted") {
    return zoneAssessment.percentAboveTarget > 40 ? "correct" : "watch";
  }
  if (cadenceDelta != null && cadenceDelta < -5) return "watch";
  if (cadenceFade != null && cadenceFade.fadePercent < -5) return "watch";
  return "none";
}

const COMMENTARY_SYSTEM_PROMPT = `You are Edu's personal running coach, writing a short note that appears on his training dashboard right after a run syncs from Strava.

Style: direct, warm, specific — like a coach who actually looked at the data, not a generic fitness-app notification. 2-4 sentences. Metric units only (km, min:sec/km, °C) — never miles, feet, °F, or lbs.

You'll be given structured facts about the run — vs. what was prescribed (if anything), heart-rate zone adherence, cadence relative to Edu's own recent average, pace fade across the run, and weather. A zone_adherence and flag verdict have already been computed by the app; your job is to explain WHY in natural coach language, not to second-guess the verdict.

- If flag is "correct": give one concrete, short correction or reminder for next time.
- If flag is "watch": note what to keep an eye on, without being alarmist.
- If flag is "none": a quick affirmation is enough — don't manufacture a critique.

If the weather explains an elevated heart rate (hot/humid), say so before judging the effort as too hard — e.g. "it was 29°C out, some of that elevated HR is heat, not pace." If there was no matched plan prescription (an unplanned/extra activity), just comment on how the session looked on its own.`;

interface CommentaryFacts {
  activity: {
    name: string;
    distanceKm: string;
    duration: string;
    avgPace: string;
    averageHeartrate: number | null;
    maxHeartrate: number | null;
    averageCadence: number | null;
    sufferScore: number | null;
  };
  prescription: {
    name: string;
    instructions: string | null;
    targetDistanceKm: string | null;
    targetDurationMinutes: number | null;
    primaryZone: string | null;
  } | null;
  zoneAdherence: {
    targetZoneRange: { min: number; max: number } | null;
    distributionPercent: Record<string, number>;
    percentAboveTarget: number;
  };
  cadence: {
    current: number | null;
    rollingAverage: number | null;
    deltaVsRollingAverage: number | null;
    secondHalfVsFirstHalfPercent: number | null;
  };
  paceFade: {
    firstHalf: string;
    secondHalf: string;
    fadePercent: number;
  } | null;
  weather: {
    tempC: string;
    conditions: string;
  } | null;
}

function buildFacts(
  activity: typeof activities.$inferSelect,
  matchedWorkout: Awaited<ReturnType<typeof findMatchingPlanWorkout>>,
  zoneAssessment: ZoneAdherenceAssessment,
  rollingCadence: number | null,
  cadenceFade: CadenceFade | null,
  paceFade: PaceFade | null,
  weather: WeatherSnapshot | null
): CommentaryFacts {
  const avgPaceSecPerKm =
    activity.movingTimeSeconds && activity.distanceMeters
      ? activity.movingTimeSeconds / (activity.distanceMeters / 1000)
      : null;

  const distributionPercent: Record<string, number> = {};
  for (const bucket of zoneAssessment.distribution) {
    distributionPercent[`zone${bucket.zone}_${bucket.name}`] = Math.round(bucket.percent * 10) / 10;
  }

  return {
    activity: {
      name: activity.name,
      distanceKm: formatKm(activity.distanceMeters),
      duration: formatDuration(activity.movingTimeSeconds),
      avgPace: formatPace(avgPaceSecPerKm),
      averageHeartrate: activity.averageHeartrate,
      maxHeartrate: activity.maxHeartrate,
      averageCadence: activity.averageCadence,
      sufferScore: activity.sufferScore,
    },
    prescription: matchedWorkout
      ? {
          name: matchedWorkout.name,
          instructions: matchedWorkout.humanReadable ?? matchedWorkout.description,
          targetDistanceKm: matchedWorkout.distanceMeters ? formatKm(matchedWorkout.distanceMeters) : null,
          targetDurationMinutes: matchedWorkout.durationMinutes,
          primaryZone: matchedWorkout.primaryZone,
        }
      : null,
    zoneAdherence: {
      targetZoneRange: zoneAssessment.targetZoneRange,
      distributionPercent,
      percentAboveTarget: Math.round(zoneAssessment.percentAboveTarget * 10) / 10,
    },
    cadence: {
      current: activity.averageCadence,
      rollingAverage: rollingCadence != null ? Math.round(rollingCadence * 10) / 10 : null,
      deltaVsRollingAverage:
        activity.averageCadence != null && rollingCadence != null
          ? Math.round((activity.averageCadence - rollingCadence) * 10) / 10
          : null,
      secondHalfVsFirstHalfPercent: cadenceFade ? Math.round(cadenceFade.fadePercent * 10) / 10 : null,
    },
    paceFade: paceFade
      ? {
          firstHalf: formatPace(paceFade.firstHalfPaceSecPerKm),
          secondHalf: formatPace(paceFade.secondHalfPaceSecPerKm),
          fadePercent: Math.round(paceFade.fadePercent * 10) / 10,
        }
      : null,
    weather: weather ? { tempC: formatTempC(weather.tempC), conditions: weather.conditions } : null,
  };
}

/**
 * Generates and persists the coach's comment for one run activity. v1 scope
 * is runs only (per project decision) — other sport types are skipped.
 * Safe to call more than once for the same activity (upserts).
 */
export async function generateCommentaryForActivity(activityId: number): Promise<void> {
  const [activity] = await db.select().from(activities).where(eq(activities.id, activityId)).limit(1);
  if (!activity) throw new Error(`Activity ${activityId} not found`);
  if (activity.sportType !== "Run") return;

  const streamsRaw = (await getOrFetchStreams(activityId)) as StravaStreamSet;
  const streamData = extractStreamArrays(streamsRaw);

  const hrZones = await getCurrentHrZones();
  const distribution =
    streamData.heartrate && streamData.heartrate.length > 0
      ? computeZoneTimeDistribution(streamData.heartrate, streamData.time, hrZones)
      : [];

  const matchedWorkout = await findMatchingPlanWorkout(activity.startDateLocal);
  const zoneAssessment = assessZoneAdherence(distribution, matchedWorkout?.primaryZone);

  const rollingCadence = await getRollingAverageCadence(activityId);
  const cadenceDelta =
    activity.averageCadence != null && rollingCadence != null
      ? activity.averageCadence - rollingCadence
      : null;
  const cadenceFade = computeCadenceFade(streamData);
  const paceFade = computePaceFade(streamData);

  let weather: WeatherSnapshot | null = null;
  if (activity.startLat != null && activity.startLng != null) {
    try {
      weather = await getWeatherAtActivityStart(activity.startLat, activity.startLng, activity.startDate);
    } catch (err) {
      console.error(`Weather lookup failed for activity ${activityId}`, err);
    }
  }

  const flag = determineFlag(zoneAssessment, cadenceDelta, cadenceFade);
  const facts = buildFacts(activity, matchedWorkout, zoneAssessment, rollingCadence, cadenceFade, paceFade, weather);

  const commentText = await generateText({
    system: COMMENTARY_SYSTEM_PROMPT,
    prompt: `Verdict already computed: zone_adherence=${zoneAssessment.adherence}, flag=${flag}\n\nFacts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nWrite the coach's comment now.`,
    maxTokens: 512,
  });

  const row = {
    activityId,
    planWorkoutId: matchedWorkout?.id ?? null,
    commentText,
    zoneAdherence: zoneAssessment.adherence,
    flag,
    cadenceAvg: activity.averageCadence,
    cadenceDeltaVsRolling: cadenceDelta,
    weatherTempC: weather?.tempC ?? null,
    weatherConditions: weather?.conditions ?? null,
    weatherRaw: weather,
    facts,
    generatedAt: new Date(),
  };

  await db
    .insert(activityComments)
    .values(row)
    .onConflictDoUpdate({ target: activityComments.activityId, set: row });
}

// Bounds the fallback-poll catch-up query to recent activities only — this
// is for a webhook that fired and got missed within the last poll cycle,
// not for retroactively commenting on backfilled training history.
const FALLBACK_POLL_LOOKBACK_DAYS = 3;

/**
 * Recent run activities with no comment yet — the fallback-poll catch-up
 * target for a Strava webhook delivery that never arrived.
 */
export async function findUncommentedRunActivityIds(): Promise<number[]> {
  const since = new Date(Date.now() - FALLBACK_POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: activities.id })
    .from(activities)
    .leftJoin(activityComments, eq(activityComments.activityId, activities.id))
    .where(
      and(eq(activities.sportType, "Run"), isNull(activityComments.id), gte(activities.startDate, since))
    );
  return rows.map((r) => r.id);
}
