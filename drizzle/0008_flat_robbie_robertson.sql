CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
