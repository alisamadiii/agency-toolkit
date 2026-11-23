CREATE TABLE "embed_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text NOT NULL,
	"user" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embed_ticket_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "embed_ticket" ADD CONSTRAINT "embed_ticket_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_external_id_unique" UNIQUE("external_id");