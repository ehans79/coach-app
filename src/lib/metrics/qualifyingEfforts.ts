import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activities,
  activityMetrics,
  activityStreams,
  athleteConstants,
  qualifyingEfforts,
  zoneVersions,
} from "@/lib/db/schema";
import { extractStreamArrays, type StreamData } from "@/lib/coaching/streams";
import type { StravaStreamSet } from "@/lib/strava/types";
import { localDateOf } from "@/lib/coaching/matching";
import { formatPaceClock } from "@/lib/format";
import { getCurrentAthleteConstants, type AthleteConstants } from "./constants";
import type { LapStructure } from "./laps";
import type { RunType } from "./classify";
import { computeAverageGapPace, computeAvgGradePercent } from "./ngp";
import { computeGradedSteadiness } from "./efficiency";
import {
  computeVdot,
  danielsTrainingPaces,
  thresholdPaceFromVdot,
  VDOT_MAX_DURATION_SECONDS,
  VDOT_MIN_DISTANCE_METERS,
  VDOT_MIN_DURATION_SECONDS,
} from "./vdot";

const STRAVA_WORKOUT_TYPE_RACE = 1;

// --- Time-trial heuristic thresholds -------------------------------------------------
// A Strava-tagged race is taken at its word. Everything else has to look like a time
// trial on its own evidence: near-maximal HR held for the whole effort, an even
// grade-adjusted pace, and no interval lap structure. These are deliberately strict —
// a false positive here doesn't just add a bad chart point, it would hand a too-fast
// threshold pace to the load engine and inflate every subsequent rTSS.

// Avg HR as a fraction of HRmax, sustained across the WHOLE activity. 0.88 is the
// athlete's own threshold HR (172/195) and Pfitzinger's ~82-91% LT band ceiling — a
// 5-45min all-out effort sits at or above it. Longer efforts sit lower by definition
// (a half-marathon is run below threshold HR), so they get the looser bar.
const TT_MIN_AVG_HR_PCT_SHORT = 0.88;
const TT_MIN_AVG_HR_PCT_LONG = 0.83;
const TT_LONG_EFFORT_SECONDS = 45 * 60;
// Peak HR has to actually get up there too — guards against a long steady run whose
// average HR creeps over the bar through drift rather than genuine intensity.
const TT_MIN_PEAK_HR_PCT = 0.93;
// Grade-adjusted pace CV. Tighter than efficiency.ts's 9% steady gate (a time trial is
// more evenly run than an ordinary steady run) but not so tight that this athlete's
// rolling terrain disqualifies real efforts. Reasoned, not a validated cutoff — same
// spirit as the STEADY_CV_THRESHOLD_PERCENT note in efficiency.ts.
const TT_MAX_GRADED_PACE_CV_PERCENT = 8;

/** How far back a qualifying effort still counts as describing CURRENT fitness. */
export const QUALIFYING_EFFORT_WINDOW_DAYS = 180;

export interface QualifyingEffortInput {
  activityId: number;
  workoutType: number | null;
  startDateLocal: Date;
  distanceMeters: number | null;
  movingTimeSeconds: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  runType: RunType;
  lapStructure: LapStructure;
  stream: StreamData;
  constants: AthleteConstants;
}

export interface QualifyingEffortResult {
  qualifies: boolean;
  /** Why it did or didn't — persisted alongside a qualifying effort, logged otherwise. */
  notes: string[];
  row: typeof qualifyingEfforts.$inferInsert | null;
}

/**
 * Decides whether one run is a "race-quality" effort a VDOT can honestly be read from,
 * and if so computes it. Deliberately evaluates the WHOLE activity rather than hunting
 * for a hard segment inside a longer run: a run with a warm-up and cool-down attached
 * isn't a time trial, and the grade-adjusted-evenness test is what rules those out.
 * Fast efforts buried inside ordinary runs are still captured — by the mean-maximal
 * best-efforts curve (bestEfforts.ts), which is the right tool for them.
 */
export function detectQualifyingEffort(input: QualifyingEffortInput): QualifyingEffortResult {
  const notes: string[] = [];
  const distanceMeters = input.distanceMeters ?? 0;
  const durationSeconds = input.movingTimeSeconds ?? 0;

  if (distanceMeters < VDOT_MIN_DISTANCE_METERS) {
    return { qualifies: false, notes: [`too short for a VDOT read (<${VDOT_MIN_DISTANCE_METERS}m)`], row: null };
  }
  if (durationSeconds < VDOT_MIN_DURATION_SECONDS || durationSeconds > VDOT_MAX_DURATION_SECONDS) {
    return { qualifies: false, notes: ["duration outside the Daniels-Gilbert validity window"], row: null };
  }

  const isStravaRace = input.workoutType === STRAVA_WORKOUT_TYPE_RACE;
  const hrPctOfMax =
    input.averageHeartrate != null && input.constants.hrMax > 0
      ? input.averageHeartrate / input.constants.hrMax
      : null;
  const peakHrPctOfMax =
    input.maxHeartrate != null && input.constants.hrMax > 0 ? input.maxHeartrate / input.constants.hrMax : null;
  const gradedSteadiness = computeGradedSteadiness(input.stream);

  if (isStravaRace) {
    notes.push("tagged as a Race in Strava");
  } else {
    // An interval session's work reps are near-maximal by design, but the session as a
    // whole isn't a sustained effort — reading a VDOT off it would be nonsense.
    if (input.lapStructure === "interval_reps" || input.runType === "interval") {
      return { qualifies: false, notes: ["interval-structured — not a sustained effort"], row: null };
    }
    if (hrPctOfMax == null) {
      return { qualifies: false, notes: ["no HR data to judge whether the effort was near-maximal"], row: null };
    }
    const minAvgHrPct = durationSeconds > TT_LONG_EFFORT_SECONDS ? TT_MIN_AVG_HR_PCT_LONG : TT_MIN_AVG_HR_PCT_SHORT;
    if (hrPctOfMax < minAvgHrPct) {
      return {
        qualifies: false,
        notes: [`avg HR ${(hrPctOfMax * 100).toFixed(0)}% of max, below the ${(minAvgHrPct * 100).toFixed(0)}% time-trial bar`],
        row: null,
      };
    }
    if (peakHrPctOfMax != null && peakHrPctOfMax < TT_MIN_PEAK_HR_PCT) {
      return {
        qualifies: false,
        notes: [`peak HR only ${(peakHrPctOfMax * 100).toFixed(0)}% of max — effort never reached race intensity`],
        row: null,
      };
    }
    if (gradedSteadiness.cvPercent == null) {
      return { qualifies: false, notes: ["not enough data to judge pace evenness"], row: null };
    }
    if (gradedSteadiness.cvPercent > TT_MAX_GRADED_PACE_CV_PERCENT) {
      return {
        qualifies: false,
        notes: [
          `grade-adjusted pace varied ${gradedSteadiness.cvPercent.toFixed(1)}% (>${TT_MAX_GRADED_PACE_CV_PERCENT}%) — paced like a workout, not a time trial`,
        ],
        row: null,
      };
    }
    notes.push(
      `sustained ${(hrPctOfMax * 100).toFixed(0)}% of max HR`,
      `grade-adjusted pace held to ${gradedSteadiness.cvPercent.toFixed(1)}% variation`,
      "no interval lap structure"
    );
  }

  // Flat-equivalent distance: the same duration run at the effort's average grade-
  // adjusted speed. See the schema comment on qualifying_efforts.graded_distance_meters
  // for why VDOT is read off this rather than raw distance.
  const gapPaceSecPerKm = computeAverageGapPace(input.stream, 0, input.stream.time.length);
  const gradedDistanceMeters =
    gapPaceSecPerKm != null && gapPaceSecPerKm > 0 ? (durationSeconds / gapPaceSecPerKm) * 1000 : distanceMeters;
  if (gapPaceSecPerKm == null) {
    notes.push("no grade data — VDOT computed from raw distance");
  }

  const vdot = computeVdot(gradedDistanceMeters, durationSeconds);
  if (vdot == null) {
    return { qualifies: false, notes: [...notes, "VDOT not computable for this distance/duration"], row: null };
  }

  return {
    qualifies: true,
    notes,
    row: {
      activityId: input.activityId,
      source: isStravaRace ? "strava_race" : "time_trial_heuristic",
      effortDate: localDateOf(input.startDateLocal),
      distanceMeters,
      gradedDistanceMeters,
      durationSeconds,
      vdot,
      avgGradePercent: computeAvgGradePercent(input.stream),
      avgHrPercentOfMax: hrPctOfMax != null ? hrPctOfMax * 100 : null,
      gradedPaceCvPercent: gradedSteadiness.cvPercent,
      detectionNotes: notes,
      computedAt: new Date(),
    },
  };
}

/** Detects and upserts the qualifying effort for one activity. Returns true if it qualified. */
export async function recordQualifyingEffort(input: QualifyingEffortInput): Promise<boolean> {
  const result = detectQualifyingEffort(input);
  if (!result.qualifies || !result.row) {
    // A previously-qualifying effort can stop qualifying if the athlete un-tags a race
    // in Strava and the activity is re-metricated — drop the stale row rather than
    // leaving a VDOT estimate standing on evidence that no longer holds.
    await db.delete(qualifyingEfforts).where(eq(qualifyingEfforts.activityId, input.activityId));
    return false;
  }
  const row = result.row;
  await db.insert(qualifyingEfforts).values(row).onConflictDoUpdate({ target: qualifyingEfforts.activityId, set: row });
  return true;
}

/**
 * Re-evaluates every already-metricated run against the detector, from cached streams
 * only — no Strava calls, so it's cheap to re-run whenever the detection thresholds are
 * tuned. The per-activity path in the pipeline covers new runs; this is what applies a
 * changed rule to the whole history (and what fills the table on a first backfill).
 */
export async function redetectQualifyingEfforts(): Promise<{ scanned: number; qualified: number }> {
  const constants = await getCurrentAthleteConstants();
  const rows = await db
    .select({
      activity: activities,
      runType: activityMetrics.runType,
      lapStructure: activityMetrics.lapStructure,
      streams: activityStreams.streams,
    })
    .from(activityMetrics)
    .innerJoin(activities, eq(activityMetrics.activityId, activities.id))
    .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(eq(activities.sportType, "Run"));

  let qualified = 0;
  for (const row of rows) {
    const didQualify = await recordQualifyingEffort({
      activityId: row.activity.id,
      workoutType: row.activity.workoutType,
      startDateLocal: row.activity.startDateLocal,
      distanceMeters: row.activity.distanceMeters,
      movingTimeSeconds: row.activity.movingTimeSeconds,
      averageHeartrate: row.activity.averageHeartrate,
      maxHeartrate: row.activity.maxHeartrate,
      runType: row.runType,
      lapStructure: row.lapStructure,
      stream: extractStreamArrays(row.streams as StravaStreamSet),
      constants,
    });
    if (didQualify) qualified += 1;
  }
  return { scanned: rows.length, qualified };
}

// ---------------------------------------------------------------------------
// VDOT reconciliation — turning the best recent qualifying effort into the athlete's
// active threshold constant and pace zones.
// ---------------------------------------------------------------------------

// Don't churn a new athlete_constants/zone_versions version over noise. 0.3 VDOT is
// roughly 3-4 sec/km of threshold pace at this athlete's level — below that the update
// isn't telling him anything, and every version row costs a real audit-trail entry.
const MIN_VDOT_CHANGE_TO_APPLY = 0.3;

export interface CurrentVdot {
  vdot: number;
  activityId: number;
  effortDate: string;
  source: "strava_race" | "time_trial_heuristic";
  distanceMeters: number;
  durationSeconds: number;
  daysAgo: number;
}

/**
 * The best qualifying effort inside the trailing window — "best", not "latest", because
 * VDOT is a capacity estimate and a slower recent effort (run in heat, or as a paced
 * group race) doesn't erase a faster one from six weeks ago. The window is what handles
 * genuine decline: an old peak simply ages out.
 */
export async function getCurrentVdot(asOfDateStr?: string): Promise<CurrentVdot | null> {
  const asOf = asOfDateStr ?? new Date().toISOString().slice(0, 10);
  const windowStart = new Date(`${asOf}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - QUALIFYING_EFFORT_WINDOW_DAYS);

  const [best] = await db
    .select()
    .from(qualifyingEfforts)
    .where(gte(qualifyingEfforts.effortDate, windowStart.toISOString().slice(0, 10)))
    .orderBy(desc(qualifyingEfforts.vdot))
    .limit(1);
  if (!best) return null;

  const daysAgo = Math.round(
    (new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${best.effortDate}T00:00:00Z`).getTime()) / 86_400_000
  );
  return {
    vdot: best.vdot,
    activityId: best.activityId,
    effortDate: best.effortDate,
    source: best.source,
    distanceMeters: best.distanceMeters,
    durationSeconds: best.durationSeconds,
    daysAgo,
  };
}

export interface VdotReconciliation {
  applied: boolean;
  reason: string;
  previousVdot: number | null;
  newVdot: number | null;
  previousThresholdPaceSecPerKm: number | null;
  newThresholdPaceSecPerKm: number | null;
  sourceActivityId: number | null;
}

/**
 * Promotes the best recent qualifying effort's VDOT into athlete_constants (new version
 * row) and its Daniels paces into zone_versions (new version row), if it differs
 * materially from what's already active.
 *
 * PROSPECTIVE ONLY, by construction rather than by a flag: computeMetricsForActivity
 * reads getCurrentAthleteConstants() at compute time and stamps the row it used onto
 * activity_metrics.constants_id, so already-computed rTSS/IF values keep the threshold
 * that actually produced them. Nothing recomputes history — the one thing that would is
 * `npm run backfill:metrics`, which is a deliberate manual re-baseline and says so.
 *
 * HR zones are carried forward untouched: VDOT is a pace model and says nothing about
 * heart rate, and rewriting hrZones would silently change every zone-time bucket.
 */
export async function reconcileVdotIntoZones(asOfDateStr?: string): Promise<VdotReconciliation> {
  const asOf = asOfDateStr ?? new Date().toISOString().slice(0, 10);

  const [current] = await db
    .select()
    .from(athleteConstants)
    .where(eq(athleteConstants.isCurrent, true))
    .orderBy(desc(athleteConstants.asOfDate))
    .limit(1);
  if (!current) {
    return {
      applied: false,
      reason: "no current athlete_constants row — run the seed script first",
      previousVdot: null,
      newVdot: null,
      previousThresholdPaceSecPerKm: null,
      newThresholdPaceSecPerKm: null,
      sourceActivityId: null,
    };
  }

  const base = {
    previousVdot: current.vdot,
    previousThresholdPaceSecPerKm: current.thresholdPaceSecPerKm,
  };

  const best = await getCurrentVdot(asOf);
  if (!best) {
    return {
      ...base,
      applied: false,
      reason: `no qualifying effort in the last ${QUALIFYING_EFFORT_WINDOW_DAYS} days`,
      newVdot: null,
      newThresholdPaceSecPerKm: null,
      sourceActivityId: null,
    };
  }

  const newThresholdPace = thresholdPaceFromVdot(best.vdot);
  if (newThresholdPace == null) {
    return {
      ...base,
      applied: false,
      reason: "threshold pace not derivable from the computed VDOT",
      newVdot: best.vdot,
      newThresholdPaceSecPerKm: null,
      sourceActivityId: best.activityId,
    };
  }
  const newThresholdPaceRounded = Math.round(newThresholdPace);

  const alreadyFromThisEffort = current.vdotSourceActivityId === best.activityId;
  const vdotDelta = current.vdot != null ? Math.abs(best.vdot - current.vdot) : Infinity;
  if (alreadyFromThisEffort || (!current.isProvisional && vdotDelta < MIN_VDOT_CHANGE_TO_APPLY)) {
    return {
      ...base,
      applied: false,
      reason: alreadyFromThisEffort
        ? "active zones already derive from this effort"
        : `VDOT moved only ${vdotDelta.toFixed(2)} — below the ${MIN_VDOT_CHANGE_TO_APPLY} threshold for a new version`,
      newVdot: best.vdot,
      newThresholdPaceSecPerKm: newThresholdPaceRounded,
      sourceActivityId: best.activityId,
    };
  }

  const [sourceActivity] = await db
    .select({ name: activities.name })
    .from(activities)
    .where(eq(activities.id, best.activityId))
    .limit(1);
  const effortLabel = `${(best.distanceMeters / 1000).toFixed(2)}km in ${Math.floor(best.durationSeconds / 60)}:${String(
    best.durationSeconds % 60
  ).padStart(2, "0")}`;
  const sourceLabel =
    best.source === "strava_race" ? "Strava-tagged race" : "detected time-trial-quality effort";
  const provenance =
    `VDOT ${best.vdot.toFixed(1)} via Daniels-Gilbert from a ${sourceLabel} on ${best.effortDate} ` +
    `(${sourceActivity?.name ?? `activity ${best.activityId}`}, ${effortLabel}, grade-adjusted). ` +
    `Threshold pace = Daniels T pace at 88% VO2max (${formatPaceClock(newThresholdPaceRounded)}/km), replacing ` +
    `${formatPaceClock(current.thresholdPaceSecPerKm)}/km. Applied prospectively — historical activity_metrics ` +
    `keep the constants that produced them. HRmax/resting HR/threshold HR carried forward from ${current.asOfDate}.`;

  const currentZones = await db
    .select()
    .from(zoneVersions)
    .where(eq(zoneVersions.isCurrent, true))
    .orderBy(desc(zoneVersions.asOfDate))
    .limit(1);
  const carriedHrZones = currentZones[0]?.hrZones ?? [];
  const paceZones = danielsTrainingPaces(best.vdot).map((p) => ({
    zone: p.zone,
    name: `${p.name} (${p.key})`,
    paceMinPerKm: `${formatPaceClock(p.fastSecPerKm)}-${formatPaceClock(p.slowSecPerKm)}`,
  }));

  await db.transaction(async (tx) => {
    await tx.update(athleteConstants).set({ isCurrent: false }).where(eq(athleteConstants.isCurrent, true));
    await tx.insert(athleteConstants).values({
      asOfDate: asOf,
      source: provenance,
      hrMax: current.hrMax,
      restingHr: current.restingHr,
      thresholdHr: current.thresholdHr,
      thresholdPaceSecPerKm: newThresholdPaceRounded,
      vdot: best.vdot,
      vdotSourceActivityId: best.activityId,
      isProvisional: false,
      isCurrent: true,
    });

    await tx.update(zoneVersions).set({ isCurrent: false }).where(eq(zoneVersions.isCurrent, true));
    await tx.insert(zoneVersions).values({
      asOfDate: asOf,
      source: `Daniels training paces from VDOT ${best.vdot.toFixed(1)} (${sourceLabel}, ${best.effortDate}). HR zones carried forward unchanged — VDOT is a pace model.`,
      hrZones: carriedHrZones,
      paceZones,
      isCurrent: true,
    });
  });

  return {
    ...base,
    applied: true,
    reason: `VDOT ${current.vdot?.toFixed(1) ?? "—"} -> ${best.vdot.toFixed(1)} from the ${best.effortDate} effort`,
    newVdot: best.vdot,
    newThresholdPaceSecPerKm: newThresholdPaceRounded,
    sourceActivityId: best.activityId,
  };
}

export interface VdotHistoryPoint {
  effortDate: string;
  vdot: number;
  activityId: number;
  activityName: string;
  source: "strava_race" | "time_trial_heuristic";
  distanceKm: number;
  durationSeconds: number;
}

/** Every qualifying effort, oldest first — the VDOT trend series. */
export async function getVdotHistory(): Promise<VdotHistoryPoint[]> {
  const rows = await db
    .select({
      effortDate: qualifyingEfforts.effortDate,
      vdot: qualifyingEfforts.vdot,
      activityId: qualifyingEfforts.activityId,
      activityName: activities.name,
      source: qualifyingEfforts.source,
      distanceMeters: qualifyingEfforts.distanceMeters,
      durationSeconds: qualifyingEfforts.durationSeconds,
    })
    .from(qualifyingEfforts)
    .innerJoin(activities, eq(qualifyingEfforts.activityId, activities.id))
    .orderBy(qualifyingEfforts.effortDate);

  return rows.map((r) => ({
    effortDate: r.effortDate,
    vdot: Math.round(r.vdot * 10) / 10,
    activityId: r.activityId,
    activityName: r.activityName,
    source: r.source,
    distanceKm: r.distanceMeters / 1000,
    durationSeconds: r.durationSeconds,
  }));
}

/**
 * Best VDOT from any qualifying effort strictly before `dateStr` — the "what was the
 * estimate standing before this run?" comparison a race comment needs.
 */
export async function getBestVdotBefore(dateStr: string): Promise<number | null> {
  const [row] = await db
    .select({ vdot: qualifyingEfforts.vdot })
    .from(qualifyingEfforts)
    .where(lt(qualifyingEfforts.effortDate, dateStr))
    .orderBy(desc(qualifyingEfforts.vdot))
    .limit(1);
  return row?.vdot ?? null;
}

/** The qualifying effort for one activity, if it was one. */
export async function getQualifyingEffortForActivity(activityId: number) {
  const [row] = await db
    .select()
    .from(qualifyingEfforts)
    .where(and(eq(qualifyingEfforts.activityId, activityId)))
    .limit(1);
  return row ?? null;
}
