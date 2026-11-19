CREATE TABLE "leads" (
	"place_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"primary_type" text,
	"address" text,
	"phone" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"distance_miles" double precision NOT NULL,
	"google_maps_url" text,
	"rating" real NOT NULL,
	"review_count" integer NOT NULL,
	"social_url" text,
	"details" jsonb,
	"details_fetched_at" timestamp with time zone,
	"design_ready" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channels_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"candidates_seen" integer DEFAULT 0 NOT NULL,
	"new_leads_saved" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"category" text NOT NULL,
	"last_searched_at" timestamp with time zone,
	"results_found" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "search_cells_point_category" UNIQUE("lat","lng","category")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"run_time" text DEFAULT '08:00' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"home_lat" double precision,
	"home_lng" double precision,
	"radius_miles" real DEFAULT 15 NOT NULL,
	"min_rating" real DEFAULT 4.5 NOT NULL,
	"min_reviews" integer DEFAULT 20 NOT NULL,
	"daily_limit" integer DEFAULT 10 NOT NULL,
	"categories" jsonb DEFAULT '["pest control","handyman","restaurant","barbershop"]'::jsonb NOT NULL,
	"max_api_calls_per_run" integer DEFAULT 60 NOT NULL,
	"cells_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "leads_design_ready_idx" ON "leads" USING btree ("design_ready");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_category_idx" ON "leads" USING btree ("category");--> statement-breakpoint
CREATE INDEX "runs_started_at_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "search_cells_last_searched_idx" ON "search_cells" USING btree ("last_searched_at");