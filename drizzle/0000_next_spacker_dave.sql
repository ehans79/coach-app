CREATE TYPE "public"."comment_flag" AS ENUM('none', 'watch', 'correct');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan_source" AS ENUM('seed', 'regeneration', 'manual');--> statement-breakpoint
CREATE TYPE "public"."zone_adherence" AS ENUM('ok', 'drifted', 'na');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sport_type" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"start_date_local" timestamp with time zone NOT NULL,
	"timezone" text,
	"distance_meters" real,
	"moving_time_seconds" integer,
	"elapsed_time_seconds" integer,
	"total_elevation_gain_meters" real,
	"average_heartrate" real,
	"max_heartrate" real,
	"average_cadence" real,
	"suffer_score" integer,
	"start_lat" double precision,
	"start_lng" double precision,
	"has_detail" boolean DEFAULT false NOT NULL,
	"has_streams" boolean DEFAULT false NOT NULL,
	"plan_workout_id" uuid,
	"raw_summary" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" bigint NOT NULL,
	"plan_workout_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment_text" text NOT NULL,
	"zone_adherence" "zone_adherence" DEFAULT 'na' NOT NULL,
	"flag" "comment_flag" DEFAULT 'none' NOT NULL,
	"cadence_avg" real,
	"cadence_delta_vs_rolling" real,
	"weather_temp_c" real,
	"weather_conditions" text,
	"weather_raw" jsonb,
	"facts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_comments_activity_id_unique" UNIQUE("activity_id")
);
--> statement-breakpoint
CREATE TABLE "activity_streams" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"streams" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"strava_athlete_id" bigint,
	"first_name" text,
	"last_name" text,
	"weight_kg" real,
	"current_focus" text,
	"current_focus_expires_at" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid,
	"week_start_date" date NOT NULL,
	"status" "email_status" NOT NULL,
	"resend_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"day_of_week" text NOT NULL,
	"workout_key" text NOT NULL,
	"sport" text NOT NULL,
	"type" text,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer,
	"distance_meters" integer,
	"primary_zone" text,
	"human_readable" text,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"week_start_date" date NOT NULL,
	"source" "plan_source" NOT NULL,
	"rationale" text,
	"guardrails_applied" jsonb,
	"plan_json" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_auth" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_activity_start_date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zone_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of_date" date NOT NULL,
	"source" text NOT NULL,
	"hr_zones" jsonb NOT NULL,
	"pace_zones" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_plan_workout_id_plan_workouts_id_fk" FOREIGN KEY ("plan_workout_id") REFERENCES "public"."plan_workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_comments" ADD CONSTRAINT "activity_comments_plan_workout_id_plan_workouts_id_fk" FOREIGN KEY ("plan_workout_id") REFERENCES "public"."plan_workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_streams" ADD CONSTRAINT "activity_streams_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_reports" ADD CONSTRAINT "email_reports_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_workouts" ADD CONSTRAINT "plan_workouts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;