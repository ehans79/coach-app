CREATE TYPE "public"."qualifying_effort_source" AS ENUM('strava_race', 'time_trial_heuristic');--> statement-breakpoint
CREATE TABLE "best_efforts" (
	"duration_seconds" integer PRIMARY KEY NOT NULL,
	"graded_speed_mps" real NOT NULL,
	"actual_speed_mps" real,
	"activity_id" bigint NOT NULL,
	"achieved_on" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "critical_speed_fits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of_date" date NOT NULL,
	"critical_speed_mps" real NOT NULL,
	"d_prime_meters" real NOT NULL,
	"r_squared" real,
	"point_count" integer NOT NULL,
	"points_used" jsonb,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualifying_efforts" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"source" "qualifying_effort_source" NOT NULL,
	"effort_date" date NOT NULL,
	"distance_meters" real NOT NULL,
	"graded_distance_meters" real NOT NULL,
	"duration_seconds" integer NOT NULL,
	"vdot" real NOT NULL,
	"avg_grade_percent" real,
	"avg_hr_percent_of_max" real,
	"graded_pace_cv_percent" real,
	"detection_notes" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athlete_constants" ADD COLUMN "vdot_source_activity_id" bigint;--> statement-breakpoint
ALTER TABLE "best_efforts" ADD CONSTRAINT "best_efforts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying_efforts" ADD CONSTRAINT "qualifying_efforts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;