CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"leg_duration_seconds" integer,
	"leg_distance_meters" integer,
	"leg_polyline" text,
	"visited_at" timestamp with time zone,
	CONSTRAINT "route_stops_route_place" UNIQUE("route_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_lat" double precision NOT NULL,
	"start_lng" double precision NOT NULL,
	"end_lat" double precision,
	"end_lng" double precision,
	"distance_meters" integer,
	"duration_seconds" integer,
	"return_duration_seconds" integer,
	"return_distance_meters" integer,
	"return_polyline" text,
	"optimized_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_place_id_leads_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."leads"("place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_stops_route_idx" ON "route_stops" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "routes_created_at_idx" ON "routes" USING btree ("created_at");