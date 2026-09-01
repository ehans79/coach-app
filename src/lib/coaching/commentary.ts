import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityComments, activityMetrics, activityMetricReps, dailyLoad } from "@/lib/db/schema";
import { getOrFetchStreams } from "@/lib/sync/activities";
import type { StravaStreamSet } from "@/lib/strava/types";
import { getCurrentHrZones, computeZoneTimeDistribution, assessZoneAdherence } from "./zones";
import { extractStreamArrays, computeCadenceFade, computePaceFade } from "./streams";
import { getRollingAverageCadence } from "./history";
import { findMatchingPlanWorkout, localDateOf } from "./matching";
import { getWeatherAtActivityStart, type WeatherSnapshot } from "@/lib/weather/openMeteo";
import { generateText } from "@/lib/llm/anthropic";
import { formatKm, formatDuration, formatPace, formatTempC } from "@/lib/format";
import type { ZoneAdherenceAssessment } from "./zones";
import type { CadenceFade, PaceFade } from "./streams";
import type { RunType, RunTypeSource } from "@/lib/metrics/classify";
import { getBestVdotBefore, getQualifyingEffortForActivity } from "@/lib/metrics/qualifyingEfforts";
import {
  computePercentOfCriticalSpeed,
  CS_BENCHMARK_ELITE_MARATHON_PERCENT,
  CS_BENCHMARK_RECREATIONAL_MARATHON_PERCENT,
} from "@/lib/metrics/criticalSpeed";

type Flag = "none" | "watch" | "correct";

function determineFlag(
  zoneAssessment: ZoneAdherenceAssessment,
  cadenceDelta: number | null,
  cadenceFade: CadenceFade | null,
  decouplingPercent: number | null,
  acwr: number | null
): Flag {
  if (zoneAssessment.adherence === "drifted") {
    return zoneAssessment.percentAboveTarget > 40 ? "correct" : "watch";
  }
  // Deterministic, not LLM-decided — same pattern as the zone-drift check above.
  // Documented thresholds from the sports-science reference doc, not arbitrary.
  if (decouplingPercent != null && decouplingPercent > 10) return "watch";
  if (acwr != null && acwr > 1.5) return "watch";
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

If the weather explains an elevated heart rate (hot/humid), say so before judging the effort as too hard — e.g. "it was 29°C out, some of that elevated HR is heat, not pace." If there was no matched plan prescription (an unplanned/extra activity), just comment on how the session looked on its own.

Alongside those facts, you'll also get a deterministically-computed metrics block (facts.runType, facts.load, facts.aerobicDurability, facts.intervalReps, facts.weeklyLoad) — Grade-Adjusted Pace, Normalized Graded Pace, TRIMP, rTSS/hrTSS, Efficiency Factor, aerobic decoupling, and weekly CTL/ATL/TSB/ACWR context, computed via standard sports-science formulas (Minetti grade-adjusted pace, Banister TRIMP, Coggan-style TSS). State the actual numbers when they matter to the story of this run (e.g. "3.2% decoupling" rather than "your aerobic fitness looked solid") — translate them into coach language rather than reciting the facts blob, and never invent a number that isn't in the facts.

Documented thresholds — only flag something as a problem when it actually crosses these, don't manufacture concern from a number sitting comfortably inside the normal range:
- Aerobic decoupling: <5% is good aerobic durability, 5-10% is unremarkable, >10% is worth flagging (fatigue, heat, dehydration, or under-conditioning — not necessarily a training failure).
- ACWR (acute:chronic workload ratio): 0.8-1.3 is the "sweet spot," >1.5 is worth a mention as elevated.

VDOT and Critical Speed are estimates too, and rougher ones than the load metrics — VDOT assumes the effort was genuinely all-out on an accurate course, and the Critical Speed fit is built from ordinary training runs rather than maximal tests, so it reads low until some truly hard efforts accumulate. Talk about them as a current best guess that sharpens over time, never as a measured capacity.

CTL/ATL/TSB/ACWR/decoupling are models built from Edu's own training data, not lab-measured facts — talk about them the way a coach reads a training log, never as a diagnostic printout ("your ACWR is 1.6" is not how a coach talks; "you've ramped up faster than usual the last week or two" is).

Apply ONLY the guidance below matching facts.runType.value — the others aren't relevant to this run:
- easy / recovery: check whether the run actually stayed easy (time in the low HR zone vs. the prescribed zone — Seiler's "was your easy run actually easy?"), note the EF/decoupling read if facts.aerobicDurability is present (decoupling should be minimal on an easy run — flag if not), mention cadence vs. baseline.
- tempo: was the effort actually in the threshold band (facts.load.intensityFactor near 1.0, roughly 0.95-1.05)? Note decoupling across the effort if present — that's the durability read on a tempo block, not just the pace.
- interval: this is about per-rep execution, not aerobic durability — walk through facts.intervalReps: pace/GAP consistency across reps, the fade % from first to last rep, whether HR recovered between reps. Don't discuss EF or decoupling here (facts.aerobicDurability will be null) — it's not meaningful on a rep-structured session.
- long: decoupling over the whole run is the durability read (>5% late in a long run points to an endurance ceiling, fueling, or heat — information, not a training failure); note any late-run pace/GAP fade alongside it.
- race: talk about pacing evenness (splits/fade) and how much of the effort held up — a performance read, not a training-load one. If facts.durability is present, work the "% of Critical Speed sustained" in as a durability read: it's the fraction of his own fitted sustainable-speed ceiling this effort held. Give the benchmarks (facts.durability.eliteMarathonBenchmarkPercent / recreationalMarathonBenchmarkPercent) as a rough orientation only, never as a target — a higher % is not automatically a better race, and going out harder to chase one is how a race falls apart. Honour facts.durability.caveat: the benchmarks were measured over marathons, so a shorter effort naturally sits higher on the curve. If facts.vdot is present, mention the new fitness estimate and whether it moved (facts.vdot.isNewBest / previousVdot) — "that's your best estimated fitness yet" reads far better than reciting the number alone.
- recovery: the main question is whether it actually stayed easy — flag it if the HR or pace looked too hard given how depleted facts.weeklyLoad.tsb (if present and negative) suggests he should be.

Weave the weekly-load context in naturally when it's relevant to the story — the run itself is still the headline, not the training-load numbers.`;

export interface CommentaryFacts {
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

  runType: { value: RunType; source: RunTypeSource };

  load: {
    primaryTss: number | null;
    tssSource: "r_tss" | "hr_tss" | "none";
    trimp: number | null;
    intensityFactor: number | null;
    ngpPace: string | null;
  };

  /** Null entirely for interval/race runs (and whenever the run wasn't steady
   * enough to compute) — decoupling/EF are only meaningful on a steady effort. */
  aerobicDurability: {
    isSteady: boolean;
    efficiencyFactor: number | null;
    decouplingPercent: number | null;
  } | null;

  /** Only populated when runType is "interval". */
  intervalReps:
    | {
        repIndex: number;
        kind: "work" | "recovery";
        distanceKm: string;
        gapPace: string | null;
        avgHr: number | null;
        fadePercent: number | null;
      }[]
    | null;

  weeklyLoad: {
    ctl: number;
    atl: number;
    tsb: number;
    acwr: number | null;
    ctlRampPerWeek: number;
  } | null;

  /** Only populated for race efforts, and only once a Critical Speed fit exists. */
  durability: {
    percentOfCriticalSpeed: number;
    criticalSpeedPace: string;
    eliteMarathonBenchmarkPercent: number;
    recreationalMarathonBenchmarkPercent: number;
    caveat: string;
  } | null;

  /** Set when this run was detected as race-quality and produced a new VDOT reading. */
  vdot: {
    value: number;
    source: "strava_race" | "time_trial_heuristic";
    isNewBest: boolean;
    previousVdot: number | null;
  } | null;
}

export interface WeeklyLoadContext {
  ctl: number;
  atl: number;
  tsb: number;
  acwr: number | null;
  ctlRampPerWeek: number;
}

/** Today's daily_load row plus the ramp vs. 7 days prior — read layer for both commentary and the weekly email. */
export async function getWeeklyLoadContext(dateStr: string): Promise<WeeklyLoadContext | null> {
  const [today] = await db
    .select()
    .from(dailyLoad)
    .where(lte(dailyLoad.date, dateStr))
    .orderBy(desc(dailyLoad.date))
    .limit(1);
  if (!today) return null;

  const weekAgoDate = new Date(`${today.date}T00:00:00Z`);
  weekAgoDate.setUTCDate(weekAgoDate.getUTCDate() - 7);
  const weekAgoDateStr = weekAgoDate.toISOString().slice(0, 10);
  const [weekAgo] = await db
    .select({ ctl: dailyLoad.ctl })
    .from(dailyLoad)
    .where(lte(dailyLoad.date, weekAgoDateStr))
    .orderBy(desc(dailyLoad.date))
    .limit(1);

  return {
    ctl: today.ctl,
    atl: today.atl,
    tsb: today.tsb,
    acwr: today.acwr,
    ctlRampPerWeek: today.ctl - (weekAgo?.ctl ?? 0),
  };
}

function buildFacts(
  activity: typeof activities.$inferSelect,
  matchedWorkout: Awaited<ReturnType<typeof findMatchingPlanWorkout>>,
  zoneAssessment: ZoneAdherenceAssessment,
  rollingCadence: number | null,
  cadenceFade: CadenceFade | null,
  paceFade: PaceFade | null,
  weather: WeatherSnapshot | null,
  metricsRow: typeof activityMetrics.$inferSelect | null,
  repRows: (typeof activityMetricReps.$inferSelect)[],
  weeklyLoad: WeeklyLoadContext | null,
  durability: CommentaryFacts["durability"],
  vdot: CommentaryFacts["vdot"]
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
    runType: metricsRow
      ? { value: metricsRow.runType, source: metricsRow.runTypeSource }
      : { value: "easy", source: "heuristic" }, // metrics unavailable (shouldn't happen post-pipeline-wiring, but keep commentary generatable)
    load: {
      primaryTss: metricsRow?.primaryTss ?? null,
      tssSource: metricsRow?.tssSource ?? "none",
      trimp: metricsRow?.trimp ?? null,
      intensityFactor: metricsRow?.intensityFactor ?? null,
      ngpPace: metricsRow?.normalizedGradedPaceSecPerKm ? formatPace(metricsRow.normalizedGradedPaceSecPerKm) : null,
    },
    aerobicDurability:
      metricsRow && metricsRow.isSteady
        ? {
            isSteady: metricsRow.isSteady,
            efficiencyFactor: metricsRow.efficiencyFactor,
            decouplingPercent: metricsRow.decouplingPercent,
          }
        : null,
    intervalReps:
      metricsRow?.runType === "interval" && repRows.length > 0
        ? repRows.map((r) => ({
            repIndex: r.repIndex,
            kind: r.kind,
            distanceKm: formatKm(r.distanceMeters),
            gapPace: r.avgGapPaceSecPerKm != null ? formatPace(r.avgGapPaceSecPerKm) : null,
            avgHr: r.avgHeartrate,
            fadePercent: r.fadePercentVsFirstRep,
          }))
        : null,
    weeklyLoad: weeklyLoad,
    durability,
    vdot,
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

  // Populated by computeMetricsForActivity, which the pipeline runs before this
  // function at every call site — absent only if that step failed or was skipped.
  const [metricsRow] = await db.select().from(activityMetrics).where(eq(activityMetrics.activityId, activityId)).limit(1);
  const repRows =
    metricsRow?.runType === "interval"
      ? await db.select().from(activityMetricReps).where(eq(activityMetricReps.activityId, activityId))
      : [];
  const weeklyLoad = await getWeeklyLoadContext(localDateOf(activity.startDateLocal));

  // Stage-2 race reads. Both stay null on ordinary runs, and the system prompt only
  // asks the model to use them when they're present.
  const effort = await getQualifyingEffortForActivity(activityId);
  let durability: CommentaryFacts["durability"] = null;
  if (metricsRow?.runType === "race" && metricsRow.gapAvgPaceSecPerKm && activity.movingTimeSeconds) {
    const read = await computePercentOfCriticalSpeed(1000 / metricsRow.gapAvgPaceSecPerKm, activity.movingTimeSeconds);
    if (read) {
      durability = {
        percentOfCriticalSpeed: Math.round(read.percentOfCriticalSpeed * 10) / 10,
        criticalSpeedPace: formatPace(read.criticalSpeedPaceSecPerKm),
        eliteMarathonBenchmarkPercent: CS_BENCHMARK_ELITE_MARATHON_PERCENT,
        recreationalMarathonBenchmarkPercent: CS_BENCHMARK_RECREATIONAL_MARATHON_PERCENT,
        caveat: read.benchmarkCaveat,
      };
    }
  }
  let vdotFacts: CommentaryFacts["vdot"] = null;
  if (effort) {
    // "Best before this one" — so the comment can say whether the effort actually moved
    // the estimate, rather than just restating the number.
    const priorBest = await getBestVdotBefore(effort.effortDate);
    vdotFacts = {
      value: Math.round(effort.vdot * 10) / 10,
      source: effort.source,
      isNewBest: priorBest == null || effort.vdot > priorBest,
      previousVdot: priorBest != null ? Math.round(priorBest * 10) / 10 : null,
    };
  }

  const flag = determineFlag(
    zoneAssessment,
    cadenceDelta,
    cadenceFade,
    metricsRow?.decouplingPercent ?? null,
    weeklyLoad?.acwr ?? null
  );
  const facts = buildFacts(
    activity,
    matchedWorkout,
    zoneAssessment,
    rollingCadence,
    cadenceFade,
    paceFade,
    weather,
    metricsRow ?? null,
    repRows,
    weeklyLoad,
    durability,
    vdotFacts
  );

  const commentText = await generateText({
    system: COMMENTARY_SYSTEM_PROMPT,
    prompt: `Verdict already computed: zone_adherence=${zoneAssessment.adherence}, flag=${flag}\n\nFacts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nWrite the coach's comment now.`,
    // Bumped from 512 — with the sports-science metrics now in the facts blob,
    // a still-concise "2-4 sentence" response legitimately needs more headroom
    // than before (512 was cutting real responses off mid-sentence).
    maxTokens: 768,
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
