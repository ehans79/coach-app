import {
  pgTable,
  text,
  integer,
  real,
  bigint,
  boolean,
  timestamp,
  date,
  jsonb,
  uuid,
  doublePrecision,
  pgEnum,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Strava auth — single row, holds the long-lived refresh token so the Sunday
// cron job and webhook handler can mint access tokens with no user present.
// ---------------------------------------------------------------------------
export const stravaAuth = pgTable("strava_auth", {
  id: integer("id").primaryKey().default(1),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: text("scope").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Athlete profile — single row, current snapshot (kept in sync from
// GET /athlete on each sync run).
// ---------------------------------------------------------------------------
export const athlete = pgTable("athlete", {
  id: integer("id").primaryKey().default(1),
  stravaAthleteId: bigint("strava_athlete_id", { mode: "number" }), // null until the first Strava connect/sync
  firstName: text("first_name"),
  lastName: text("last_name"),
  weightKg: real("weight_kg"),
  currentFocus: text("current_focus"),
  currentFocusExpiresAt: date("current_focus_expires_at"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Zone versions — HR + pace zones, versioned by as_of_date since they get
// recalculated (e.g. after a pace-zone retest). Exactly one row should be
// current at a time.
// ---------------------------------------------------------------------------
export const zoneVersions = pgTable("zone_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  asOfDate: date("as_of_date").notNull(),
  source: text("source").notNull(),
  hrZones: jsonb("hr_zones").notNull(), // [{ zone, name, hrLow, hrHigh }]
  paceZones: jsonb("pace_zones").notNull(), // [{ zone, name, paceMinPerKm }]
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Activities — cached Strava activity summaries. Incremental sync by
// start_date; details/streams fetched selectively (see activity_streams).
// ---------------------------------------------------------------------------
export const activities = pgTable("activities", {
  id: bigint("id", { mode: "number" }).primaryKey(), // Strava activity id
  name: text("name").notNull(),
  sportType: text("sport_type").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  startDateLocal: timestamp("start_date_local", { withTimezone: true }).notNull(),
  timezone: text("timezone"),
  distanceMeters: real("distance_meters"),
  movingTimeSeconds: integer("moving_time_seconds"),
  elapsedTimeSeconds: integer("elapsed_time_seconds"),
  totalElevationGainMeters: real("total_elevation_gain_meters"),
  averageHeartrate: real("average_heartrate"),
  maxHeartrate: real("max_heartrate"),
  averageCadence: real("average_cadence"),
  sufferScore: integer("suffer_score"),
  startLat: doublePrecision("start_lat"),
  startLng: doublePrecision("start_lng"),
  hasDetail: boolean("has_detail").notNull().default(false),
  hasStreams: boolean("has_streams").notNull().default(false),
  planWorkoutId: uuid("plan_workout_id").references(() => planWorkouts.id, {
    onDelete: "set null",
  }),
  rawSummary: jsonb("raw_summary"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Activity streams — cached raw Strava time-series payload, fetched once per
// activity and reused by both the commentary and regeneration logic.
// ---------------------------------------------------------------------------
export const activityStreams = pgTable("activity_streams", {
  activityId: bigint("activity_id", { mode: "number" })
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  streams: jsonb("streams").notNull(), // raw { heartrate, time, distance, velocity_smooth, cadence, latlng, temp }
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Plans — one row per generated plan version. Never overwritten; the active
// version is flagged so the dashboard can show plan history + evolution.
// ---------------------------------------------------------------------------
export const planSourceEnum = pgEnum("plan_source", ["seed", "regeneration", "manual"]);

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  version: integer("version").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  weekStartDate: date("week_start_date").notNull(),
  source: planSourceEnum("source").notNull(),
  rationale: text("rationale"),
  guardrailsApplied: jsonb("guardrails_applied"), // computed heuristic facts/limits used this cycle
  planJson: jsonb("plan_json").notNull(), // full plan doc — meta/preferences/assessment/zones/phases/weeks
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Plan workouts — normalized per-session rows derived from plans.plan_json,
// so the dashboard and activity-matching logic can query individual sessions
// without parsing the JSON blob every time.
// ---------------------------------------------------------------------------
export const planWorkouts = pgTable("plan_workouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  dayOfWeek: text("day_of_week").notNull(),
  workoutKey: text("workout_key").notNull(), // matches the `id` field inside plan_json
  sport: text("sport").notNull(), // run | strength | rest | bike | ...
  type: text("type"),
  name: text("name").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes"),
  distanceMeters: integer("distance_meters"),
  primaryZone: text("primary_zone"),
  humanReadable: text("human_readable"),
  completed: boolean("completed").notNull().default(false),
});

// ---------------------------------------------------------------------------
// Activity comments — one per activity, the generated coach commentary.
// ---------------------------------------------------------------------------
export const zoneAdherenceEnum = pgEnum("zone_adherence", ["ok", "drifted", "na"]);
export const commentFlagEnum = pgEnum("comment_flag", ["none", "watch", "correct"]);

export const activityComments = pgTable("activity_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  activityId: bigint("activity_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => activities.id, { onDelete: "cascade" }),
  planWorkoutId: uuid("plan_workout_id").references(() => planWorkouts.id, {
    onDelete: "set null",
  }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  commentText: text("comment_text").notNull(),
  zoneAdherence: zoneAdherenceEnum("zone_adherence").notNull().default("na"),
  flag: commentFlagEnum("flag").notNull().default("none"),
  cadenceAvg: real("cadence_avg"),
  cadenceDeltaVsRolling: real("cadence_delta_vs_rolling"),
  weatherTempC: real("weather_temp_c"),
  weatherConditions: text("weather_conditions"),
  weatherRaw: jsonb("weather_raw"),
  facts: jsonb("facts"), // structured heuristic facts fed to the LLM, kept for transparency/debugging
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Email reports — light send log; content is regenerated on demand from
// plans + activity_comments rather than stored.
// ---------------------------------------------------------------------------
export const emailStatusEnum = pgEnum("email_status", ["sent", "failed"]);

export const emailReports = pgTable("email_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
  weekStartDate: date("week_start_date").notNull(),
  status: emailStatusEnum("status").notNull(),
  resendMessageId: text("resend_message_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sync state — operational bookkeeping for incremental Strava sync + the
// fallback poll (catches any activity a missed webhook never fired for).
// ---------------------------------------------------------------------------
export const syncState = pgTable("sync_state", {
  id: text("id").primaryKey(), // 'strava'
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastActivityStartDate: timestamp("last_activity_start_date", { withTimezone: true }),
});
