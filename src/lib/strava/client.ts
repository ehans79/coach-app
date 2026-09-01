import { getValidAccessToken } from "./tokens";
import { getEnv } from "@/lib/env";
import type {
  StravaAthlete,
  StravaAthleteZones,
  StravaSummaryActivity,
  StravaDetailedActivity,
  StravaStreamSet,
  StravaStreamType,
  StravaLap,
  StravaPushSubscription,
} from "./types";

const API_BASE = "https://www.strava.com/api/v3";

type QueryParams = Record<string, string | number | boolean | undefined>;

async function stravaGet<T>(path: string, params?: QueryParams): Promise<T> {
  const accessToken = await getValidAccessToken();
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getAthleteProfile(): Promise<StravaAthlete> {
  return stravaGet<StravaAthlete>("/athlete");
}

export async function getAthleteZones(): Promise<StravaAthleteZones> {
  return stravaGet<StravaAthleteZones>("/athlete/zones");
}

/**
 * Lists activities in reverse-chronological order. `after`/`before` are unix
 * epoch seconds. Strava paginates at up to 200/page.
 */
export async function listActivities(options: {
  after?: number;
  before?: number;
  page?: number;
  perPage?: number;
}): Promise<StravaSummaryActivity[]> {
  return stravaGet<StravaSummaryActivity[]>("/athlete/activities", {
    after: options.after,
    before: options.before,
    page: options.page ?? 1,
    per_page: options.perPage ?? 100,
  });
}

/** Fetches every activity after `afterEpochSeconds`, following pagination. */
export async function listAllActivitiesSince(
  afterEpochSeconds: number
): Promise<StravaSummaryActivity[]> {
  const all: StravaSummaryActivity[] = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const batch = await listActivities({ after: afterEpochSeconds, page, perPage });
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return all;
}

export async function getActivityDetail(id: number): Promise<StravaDetailedActivity> {
  return stravaGet<StravaDetailedActivity>(`/activities/${id}`);
}

export const DEFAULT_STREAM_KEYS: StravaStreamType[] = [
  "time",
  "distance",
  "heartrate",
  "cadence",
  "velocity_smooth",
  "latlng",
  "temp",
  // grade_smooth/altitude/moving power the metrics engine's GAP/NGP (src/lib/metrics/) —
  // grade_smooth is Strava's own pre-smoothed per-point grade, used directly rather than
  // re-deriving grade from raw altitude (which is noisy) ourselves.
  "grade_smooth",
  "altitude",
  "moving",
  // Wrist-based running power from the watch, carried through by Strava with
  // device_watts=true. Absent on activities recorded without a power-capable device —
  // which is exactly why the cache freshness check keys off the REQUESTED key set
  // rather than which keys came back (see getOrFetchStreams).
  "watts",
];

export async function getActivityStreams(
  id: number,
  keys: StravaStreamType[] = DEFAULT_STREAM_KEYS
): Promise<StravaStreamSet> {
  return stravaGet<StravaStreamSet>(`/activities/${id}/streams`, {
    keys: keys.join(","),
    key_by_type: true,
  });
}

export async function getActivityLaps(id: number): Promise<StravaLap[]> {
  return stravaGet<StravaLap[]>(`/activities/${id}/laps`);
}

export async function createPushSubscription(callbackUrl: string): Promise<{ id: number }> {
  const env = getEnv();
  const res = await fetch(`${API_BASE}/push_subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      callback_url: callbackUrl,
      verify_token: env.STRAVA_VERIFY_TOKEN,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava push subscription create failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function listPushSubscriptions(): Promise<StravaPushSubscription[]> {
  const env = getEnv();
  const url = new URL(`${API_BASE}/push_subscriptions`);
  url.searchParams.set("client_id", env.STRAVA_CLIENT_ID);
  url.searchParams.set("client_secret", env.STRAVA_CLIENT_SECRET);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava push subscription list failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function deletePushSubscription(id: number): Promise<void> {
  const env = getEnv();
  const url = new URL(`${API_BASE}/push_subscriptions/${id}`);
  url.searchParams.set("client_id", env.STRAVA_CLIENT_ID);
  url.searchParams.set("client_secret", env.STRAVA_CLIENT_SECRET);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Strava push subscription delete failed (${res.status}): ${text}`);
  }
}
