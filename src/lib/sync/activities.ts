import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activities, activityStreams, syncState } from "@/lib/db/schema";
import {
  listAllActivitiesSince,
  getActivityDetail,
  getActivityStreams,
} from "@/lib/strava/client";
import type { StravaSummaryActivity, StravaDetailedActivity } from "@/lib/strava/types";

const SYNC_ID = "strava";
const DEFAULT_LOOKBACK_DAYS = 14;
// Re-fetch a small overlap window on every incremental sync so an activity
// that was still uploading (partial data) at the last sync gets refreshed.
const OVERLAP_SECONDS = 3600;

function toActivityRow(activity: StravaSummaryActivity | StravaDetailedActivity) {
  const latlng = "start_latlng" in activity ? activity.start_latlng : undefined;
  const [lat, lng] = latlng && latlng.length === 2 ? latlng : [null, null];
  return {
    id: activity.id,
    name: activity.name,
    sportType: activity.sport_type,
    startDate: new Date(activity.start_date),
    startDateLocal: new Date(activity.start_date_local),
    timezone: activity.timezone ?? null,
    distanceMeters: activity.distance ?? null,
    movingTimeSeconds: activity.moving_time ?? null,
    elapsedTimeSeconds: activity.elapsed_time ?? null,
    totalElevationGainMeters: activity.total_elevation_gain ?? null,
    averageHeartrate: activity.average_heartrate ?? null,
    maxHeartrate: activity.max_heartrate ?? null,
    averageCadence: activity.average_cadence ?? null,
    sufferScore: activity.suffer_score ?? null,
    startLat: lat,
    startLng: lng,
    rawSummary: activity,
    syncedAt: new Date(),
  };
}

/** Upserts every activity started after `afterEpochSeconds`. Returns the count synced. */
export async function upsertActivitiesSince(afterEpochSeconds: number): Promise<number> {
  const list = await listAllActivitiesSince(afterEpochSeconds);
  for (const activity of list) {
    const row = toActivityRow(activity);
    await db
      .insert(activities)
      .values(row)
      .onConflictDoUpdate({ target: activities.id, set: row });
  }
  return list.length;
}

/** Fetches full detail (not just the list summary) for one activity and upserts it. */
export async function syncSingleActivityDetail(
  activityId: number
): Promise<StravaDetailedActivity> {
  const detail = await getActivityDetail(activityId);
  const row = { ...toActivityRow(detail), hasDetail: true };
  await db.insert(activities).values(row).onConflictDoUpdate({ target: activities.id, set: row });
  return detail;
}

/** Returns cached streams for an activity, fetching + caching them from Strava if absent. */
export async function getOrFetchStreams(activityId: number) {
  const [existing] = await db
    .select()
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .limit(1);
  if (existing) return existing.streams;

  const streams = await getActivityStreams(activityId);
  await db
    .insert(activityStreams)
    .values({ activityId, streams })
    .onConflictDoUpdate({ target: activityStreams.activityId, set: { streams, fetchedAt: new Date() } });
  await db.update(activities).set({ hasStreams: true }).where(eq(activities.id, activityId));
  return streams;
}

/**
 * Incremental sync: pulls everything since the last recorded activity start
 * date (with a small overlap), or the last DEFAULT_LOOKBACK_DAYS on first
 * run. Used by the weekly regeneration job and the hourly fallback poll.
 */
export async function syncRecentActivities(): Promise<{ count: number }> {
  const [state] = await db.select().from(syncState).where(eq(syncState.id, SYNC_ID)).limit(1);

  const after = state?.lastActivityStartDate
    ? Math.floor(state.lastActivityStartDate.getTime() / 1000) - OVERLAP_SECONDS
    : Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_DAYS * 86400;

  const count = await upsertActivitiesSince(after);

  // Raw sql`` results bypass Drizzle's column mapFromDriverValue — the
  // driver hands back a timestamptz as a string here, not a Date, whatever
  // the sql<T> type annotation claims. Parse it explicitly.
  const [latest] = await db
    .select({ maxStart: sql<string | null>`max(${activities.startDate})` })
    .from(activities);

  const newState = {
    id: SYNC_ID,
    lastSyncedAt: new Date(),
    lastActivityStartDate: latest?.maxStart
      ? new Date(latest.maxStart)
      : (state?.lastActivityStartDate ?? null),
  };
  await db
    .insert(syncState)
    .values(newState)
    .onConflictDoUpdate({ target: syncState.id, set: newState });

  return { count };
}
