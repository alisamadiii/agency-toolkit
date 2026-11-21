# Lead Finder: notes for Claude

@AGENTS.md

Finds local businesses near Jacksonville, FL that have great Google reviews and no website. Ali turns them into spec websites and pitches them.

## How it runs

- **Production (Coolify)** runs only `scripts/scheduler.ts`. It is a long-running Node process: node-cron ticks every minute, reads the `settings` row, and runs `runLeadFinder()` once per local day at or after `settings.run_time`. It also serves `GET /health`.
- **The dashboard (Next.js) is never deployed.** Ali runs it locally with `pnpm dev`, against the same Neon `DATABASE_URL`. It does not start a scheduler.
- The core logic is in `src/lib/jobs/lead-finder.ts`. The pure helpers are `src/lib/{geo,social,filter,time}.ts`, and they have Vitest tests in `tests/`.
- Secrets live in env (`DATABASE_URL`, `GOOGLE_MAPS_API_KEY`). Everything else (schedule, home, radius, thresholds, categories, API budget) lives in the `settings` table and is edited from the dashboard.
- Discord is optional. It is configured in the `notification_channels` table from Settings. If no channel is enabled, nothing is sent.

## Database rule

Drizzle ORM + Neon. **Schema change = edit `src/db/schema.ts` → `pnpm db:generate` → commit the SQL in `drizzle/` → `pnpm db:migrate`. Never use `drizzle-kit push`.** The production container runs `drizzle-kit migrate` on start.

## Picking the next lead to design

Claim it atomically so two sessions never take the same business:

```sql
UPDATE leads SET status = 'designing', claimed_at = now(), updated_at = now()
WHERE place_id = (
  SELECT place_id FROM leads
  WHERE status = 'new' AND design_ready = false
  ORDER BY review_count * rating DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

If Ali gives a place ID (copied from the dashboard's Leads table), design that lead instead: `SELECT * FROM leads WHERE place_id = '<id>'`. Refuse if its status is `hidden`.

1. If `details` is null (it is cleared after 30 days, per Google's terms), fetch it first: `pnpm lead:refresh <place_id>`.
2. The claim above already sets `status = 'designing'` and `claimed_at`.
3. When the design is done: `pnpm lead:status <place_id> design-ready`. This sets `design_ready = true` and `status = 'design_ready'`.

Status flow: `new` → `designing` → `design_ready` → `contacted` → `won` / `lost` / `skipped`. `hidden` = Ali hid it from the dashboard; never design a hidden lead (the query above only picks `new`).

Ali also changes `status` from his phone with the Agency iOS app (`apps/agency`), so a lead he already designed elsewhere or ruled out will not be `new`. Trust the status in the database.

NFC review cards: `review_link` holds the Google "write a review" link (filled on insert, backfilled by migration 0002; Ali may overwrite it with the owner's `g.page/r/.../review` link). `nfc_cards_written_at` is set by the Agency iOS app when it writes that link onto a card. Ali can also add leads from the app; those rows have `details` null until `pnpm lead:refresh`. The app connects as the Postgres role `agency_ios`, which has column-level grants only: read lead basics (incl. `lat`, `lng`, `distance_miles`, `phone`, `google_maps_url`) plus `settings.home_lat/home_lng/categories`, insert basic lead columns, update `status`, `design_ready`, `review_link`, `nfc_cards_written_at` and `updated_at`, and has full access to `routes` / `route_stops`. A new column the app needs must be granted to that role.

Distance: the dashboard and the iOS app sort leads nearest to home first, with miles computed live in SQL from `lat`/`lng` and `settings.home_lat/home_lng` (`milesFromHome()` in `src/lib/distance-sql.ts`). The stored `distance_miles` is measured from the home set when the lead was found and is stale for older leads; don't sort or filter on it.

Smart Route: `routes` and `route_stops` (migration 0003) belong to the Agency iOS app. It builds a day's visiting route from picked leads, orders stops with the Google Routes API and marks each stop visited/failed. The dashboard doesn't read them; don't change them from lead-finder code.

`details` holds the full Place Details response: `reviews`, `photos` (photo `name`s, which are served locally by `/api/photo/<name>`), `regularOpeningHours`, `editorialSummary`, `types` and `priceLevel`. Use it for copy, hours and imagery in the design.
