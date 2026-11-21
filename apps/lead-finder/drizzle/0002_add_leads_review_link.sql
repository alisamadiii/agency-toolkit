ALTER TABLE "leads" ADD COLUMN "review_link" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "nfc_cards_written_at" timestamp with time zone;--> statement-breakpoint
UPDATE "leads" SET "review_link" = 'https://search.google.com/local/writereview?placeid=' || "place_id" WHERE "review_link" IS NULL;
