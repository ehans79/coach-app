CREATE TABLE "best_power_efforts" (
	"duration_seconds" integer PRIMARY KEY NOT NULL,
	"watts" real NOT NULL,
	"activity_id" bigint NOT NULL,
	"achieved_on" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "critical_power_fits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"as_of_date" date NOT NULL,
	"critical_power_watts" real NOT NULL,
	"w_prime_joules" real NOT NULL,
	"r_squared" real,
	"point_count" integer NOT NULL,
	"points_used" jsonb,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_metrics" ADD COLUMN "avg_power_watts" real;--> statement-breakpoint
ALTER TABLE "activity_metrics" ADD COLUMN "normalized_power_watts" real;--> statement-breakpoint
ALTER TABLE "activity_metrics" ADD COLUMN "power_artifact_samples" integer;--> statement-breakpoint
ALTER TABLE "activity_streams" ADD COLUMN "fetched_keys" jsonb;--> statement-breakpoint
ALTER TABLE "best_power_efforts" ADD CONSTRAINT "best_power_efforts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;