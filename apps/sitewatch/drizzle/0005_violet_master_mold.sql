CREATE TABLE "job_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"duration_ms" integer,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"uptime_pulse_interval_minutes" integer DEFAULT 5 NOT NULL,
	"deep_crawl_interval_hours" integer DEFAULT 24 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "job_execution_id" uuid;--> statement-breakpoint
CREATE INDEX "job_exec_name_time_idx" ON "job_executions" USING btree ("job_name","started_at");