CREATE TABLE "coach_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start_date" date NOT NULL,
	"week_end_date" date NOT NULL,
	"summary_text" text NOT NULL,
	"is_sparse" boolean NOT NULL,
	"available_read_count" integer NOT NULL,
	"total_read_count" integer NOT NULL,
	"inputs" jsonb NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_reads_week_start_date_unique" UNIQUE("week_start_date")
);
