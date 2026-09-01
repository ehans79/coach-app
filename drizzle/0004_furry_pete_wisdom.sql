CREATE TYPE "public"."lap_structure" AS ENUM('none', 'uniform_auto', 'interval_reps', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."rep_kind" AS ENUM('work', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."run_type" AS ENUM('easy', 'tempo', 'long', 'interval', 'race', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."run_type_source" AS ENUM('strava_race', 'strava_long_run', 'heuristic');--> statement-breakpoint
CREATE TYPE "public"."tss_source" AS ENUM('r_tss', 'hr_tss', 'none');--> statement-breakpoint
CREATE TABLE "activity_metric_reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" bigint NOT NULL,
	"lap_index" integer NOT NULL,
	"rep_index" integer NOT NULL,
	"kind" "rep_kind" NOT NULL,
	"distance_meters" real NOT NULL,
	"duration_seconds" integer NOT NULL,
	"avg_pace_sec_per_km" real,
	"avg_gap_pace_sec_per_km" real,
	"avg_heartrate" real,
	"max_heartrate" real,
	"fade_percent_vs_first_rep" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_metrics" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"run_type" "run_type" NOT NULL,
	"run_type_source" "run_type_source" NOT NULL,
	"lap_structure" "lap_structure" DEFAULT 'none' NOT NULL,
	"is_steady" boolean DEFAULT false NOT NULL,
	"pace_cv_percent" real,
	"gap_avg_pace_sec_per_km" real,
	"normalized_graded_pace_sec_per_km" real,
	"ngp_moving_duration_seconds" integer,
	"avg_grade_percent" real,
	"trimp" real,
	"r_tss" real,
	"hr_tss" real,
	"primary_tss" real,
	"tss_source" "tss_source" DEFAULT 'none' NOT NULL,
	"intensity_factor" real,
	"efficiency_factor" real,
	"decoupling_percent" real,
	"zone_seconds_low" integer,
	"zone_seconds_moderate" integer,
	"zone_seconds_high" integer,
	"constants_id" uuid,
	"metrics_version" integer DEFAULT 1 NOT NULL,
	"warnings" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete_constants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of_date" date NOT NULL,
	"source" text NOT NULL,
	"hr_max" integer NOT NULL,
	"resting_hr" integer NOT NULL,
	"threshold_hr" integer NOT NULL,
	"threshold_pace_sec_per_km" integer NOT NULL,
	"vdot" real,
	"is_provisional" boolean DEFAULT false NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_load" (
	"date" date PRIMARY KEY NOT NULL,
	"total_tss" real DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"ctl" real DEFAULT 0 NOT NULL,
	"atl" real DEFAULT 0 NOT NULL,
	"tsb" real DEFAULT 0 NOT NULL,
	"acute_avg_load_7d" real,
	"chronic_avg_load_21d" real,
	"acwr" real,
	"zone_seconds_low" integer DEFAULT 0 NOT NULL,
	"zone_seconds_moderate" integer DEFAULT 0 NOT NULL,
	"zone_seconds_high" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "workout_type" integer;--> statement-breakpoint
ALTER TABLE "activity_metric_reps" ADD CONSTRAINT "activity_metric_reps_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_metrics" ADD CONSTRAINT "activity_metrics_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_metrics" ADD CONSTRAINT "activity_metrics_constants_id_athlete_constants_id_fk" FOREIGN KEY ("constants_id") REFERENCES "public"."athlete_constants"("id") ON DELETE set null ON UPDATE no action;