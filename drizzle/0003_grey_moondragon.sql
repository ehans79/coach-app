CREATE TYPE "public"."strength_section" AS ENUM('warm_up', 'circuit', 'core_finisher', 'cool_down');--> statement-breakpoint
CREATE TABLE "garmin_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garmin_exercises_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "plan_workout_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_workout_id" uuid NOT NULL,
	"section" "strength_section" NOT NULL,
	"order_index" integer NOT NULL,
	"garmin_exercise_id" uuid,
	"exercise_name" text NOT NULL,
	"sets" integer,
	"reps" text NOT NULL,
	"rest_between_sets_seconds" integer,
	"rounds" text,
	"rest_between_rounds_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_workout_exercises" ADD CONSTRAINT "plan_workout_exercises_plan_workout_id_plan_workouts_id_fk" FOREIGN KEY ("plan_workout_id") REFERENCES "public"."plan_workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_workout_exercises" ADD CONSTRAINT "plan_workout_exercises_garmin_exercise_id_garmin_exercises_id_fk" FOREIGN KEY ("garmin_exercise_id") REFERENCES "public"."garmin_exercises"("id") ON DELETE set null ON UPDATE no action;