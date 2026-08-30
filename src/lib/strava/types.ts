// Minimal shapes for the Strava API v3 fields this app actually reads.
// Not exhaustive — extend as new fields are needed.

export interface StravaTokenResponse {
  token_type: "Bearer";
  expires_at: number; // unix seconds
  expires_in: number;
  refresh_token: string;
  access_token: string;
  scope?: string;
}

export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  weight: number | null;
  measurement_preference: "feet" | "meters";
  // Present when the "profile:read_all" scope + custom fields are shared;
  // not part of the base Strava athlete schema but Edu's profile carries it.
  current_focus?: string | null;
}

export interface StravaZoneRange {
  min: number;
  max: number;
}

export interface StravaAthleteZones {
  heart_rate: {
    custom_zones: boolean;
    zones: StravaZoneRange[];
  };
  power?: {
    zones: StravaZoneRange[];
  };
}

export interface StravaSummaryActivity {
  id: number;
  name: string;
  sport_type: string;
  type: string;
  start_date: string; // ISO 8601 UTC
  start_date_local: string; // ISO 8601 in activity's local tz
  timezone: string; // e.g. "(GMT+00:00) Europe/Lisbon"
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number; // meters
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  suffer_score?: number;
  start_latlng?: [number, number] | [];
}

export interface StravaDetailedActivity extends StravaSummaryActivity {
  description?: string | null;
  calories?: number;
  device_name?: string;
}

export type StravaStreamType =
  | "time"
  | "distance"
  | "latlng"
  | "altitude"
  | "velocity_smooth"
  | "heartrate"
  | "cadence"
  | "watts"
  | "temp"
  | "moving"
  | "grade_smooth";

export type StravaStreamSet = Partial<
  Record<
    StravaStreamType,
    {
      data: number[] | [number, number][] | boolean[];
      series_type: string;
      original_size: number;
      resolution: string;
    }
  >
>;

export interface StravaPushSubscription {
  id: number;
  callback_url: string;
  created_at: string;
  updated_at: string;
}
