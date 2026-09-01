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
  // Strava's own athlete-asserted workout label: null/0=default, 1=Race, 2=Long Run,
  // 3=Workout — a strong prior for the run-type classifier (see src/lib/metrics/classify.ts).
  workoutType: integer("workout_type"),
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

// ---------------------------------------------------------------------------
// Athlete constants — HRmax/resting HR/threshold pace+HR feeding the deterministic
// metrics engine (src/lib/metrics/). Versioned exactly like zone_versions: updating
// means inserting a new row with isCurrent=true and flipping the old one false, never
// overwriting in place, so historical activity_metrics rows keep a stable FK to the
// constants that actually produced them (see activity_metrics.constants_id below).
// ---------------------------------------------------------------------------
export const athleteConstants = pgTable("athlete_constants", {
  id: uuid("id").defaultRandom().primaryKey(),
  asOfDate: date("as_of_date").notNull(),
  source: text("source").notNull(), // human-readable provenance — how each number was derived
  hrMax: integer("hr_max").notNull(),
  restingHr: integer("resting_hr").notNull(),
  thresholdHr: integer("threshold_hr").notNull(),
  thresholdPaceSecPerKm: integer("threshold_pace_sec_per_km").notNull(),
  vdot: real("vdot"),
  isProvisional: boolean("is_provisional").notNull().default(false),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Activity metrics — deterministic, non-LLM sports-science metrics computed per
// Run activity (src/lib/metrics/pipeline.ts), on sync, before commentary generation.
// 1:1 with activities (PK = activity_id), mirroring activity_streams' shape. Per-point
// GAP/NGP series are deliberately NOT stored here — only scalar aggregates; charts
// recompute the point series on read from the already-cached activity_streams.
// ---------------------------------------------------------------------------
export const runTypeEnum = pgEnum("run_type", ["easy", "tempo", "long", "interval", "race", "recovery"]);
export const runTypeSourceEnum = pgEnum("run_type_source", ["strava_race", "strava_long_run", "heuristic"]);
export const lapStructureEnum = pgEnum("lap_structure", ["none", "uniform_auto", "interval_reps", "mixed"]);
export const tssSourceEnum = pgEnum("tss_source", ["r_tss", "hr_tss", "none"]);
export const repKindEnum = pgEnum("rep_kind", ["work", "recovery"]);

export const activityMetrics = pgTable("activity_metrics", {
  activityId: bigint("activity_id", { mode: "number" })
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  runType: runTypeEnum("run_type").notNull(),
  runTypeSource: runTypeSourceEnum("run_type_source").notNull(),
  lapStructure: lapStructureEnum("lap_structure").notNull().default("none"),
  isSteady: boolean("is_steady").notNull().default(false),
  paceCvPercent: real("pace_cv_percent"), // raw CV% — kept for threshold-tuning transparency
  gapAvgPaceSecPerKm: real("gap_avg_pace_sec_per_km"), // simple distance-weighted avg GAP
  normalizedGradedPaceSecPerKm: real("normalized_graded_pace_sec_per_km"), // NGP — primary scalar
  ngpMovingDurationSeconds: integer("ngp_moving_duration_seconds"), // moving time used in NGP/rTSS
  avgGradePercent: real("avg_grade_percent"),
  trimp: real("trimp"),
  rTss: real("r_tss"),
  hrTss: real("hr_tss"),
  primaryTss: real("primary_tss"),
  tssSource: tssSourceEnum("tss_source").notNull().default("none"),
  intensityFactor: real("intensity_factor"), // NGP speed ÷ threshold speed
  efficiencyFactor: real("efficiency_factor"),
  decouplingPercent: real("decoupling_percent"),
  // HR-zone time buckets, Seiler-style 3-zone split anchored on threshold HR:
  // low = Z1+Z2 (<157bpm), moderate = Z3 (157-171bpm), high = Z4+Z5 (>=172bpm, >= threshold HR).
  zoneSecondsLow: integer("zone_seconds_low"),
  zoneSecondsModerate: integer("zone_seconds_moderate"),
  zoneSecondsHigh: integer("zone_seconds_high"),
  constantsId: uuid("constants_id").references(() => athleteConstants.id, { onDelete: "set null" }),
  metricsVersion: integer("metrics_version").notNull().default(1),
  warnings: jsonb("warnings"), // string[] — e.g. "grade_smooth missing, GAP/NGP unadjusted"
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Activity metric reps — per-rep breakdown for interval-structured runs, detected
// from Strava lap data (src/lib/metrics/laps.ts). A "recovery" row shares the
// rep_index of the "work" rep it immediately follows (not unique per row) — a
// deliberate modeling choice so work/recovery pairs stay easy to group in charts.
// ---------------------------------------------------------------------------
export const activityMetricReps = pgTable("activity_metric_reps", {
  id: uuid("id").defaultRandom().primaryKey(),
  activityId: bigint("activity_id", { mode: "number" })
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  lapIndex: integer("lap_index").notNull(), // original Strava lap_index, for traceability
  repIndex: integer("rep_index").notNull(), // 1-based among 'work' laps
  kind: repKindEnum("kind").notNull(),
  distanceMeters: real("distance_meters").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  avgPaceSecPerKm: real("avg_pace_sec_per_km"),
  avgGapPaceSecPerKm: real("avg_gap_pace_sec_per_km"),
  avgHeartrate: real("avg_heartrate"),
  maxHeartrate: real("max_heartrate"),
  fadePercentVsFirstRep: real("fade_percent_vs_first_rep"), // 'work' rows only; 0 for rep 1
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Daily load — one row per calendar date (athlete's local date), the rollup that
// powers CTL/ATL/TSB/ACWR and the weekly intensity-distribution charts. Pure
// aggregation over activity_metrics (src/lib/metrics/rollup.ts) — no Strava/LLM
// calls — so it's cheap enough to fully recompute on every call, self-healing
// after any backfill or athlete_constants change.
// ---------------------------------------------------------------------------
export const dailyLoad = pgTable("daily_load", {
  date: date("date").primaryKey(),
  totalTss: real("total_tss").notNull().default(0),
  runCount: integer("run_count").notNull().default(0),
  ctl: real("ctl").notNull().default(0),
  atl: real("atl").notNull().default(0),
  tsb: real("tsb").notNull().default(0),
  acuteAvgLoad7d: real("acute_avg_load_7d"),
  chronicAvgLoad21d: real("chronic_avg_load_21d"),
  acwr: real("acwr"), // null until >=28 days of history exist
  zoneSecondsLow: integer("zone_seconds_low").notNull().default(0),
  zoneSecondsModerate: integer("zone_seconds_moderate").notNull().default(0),
  zoneSecondsHigh: integer("zone_seconds_high").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});
