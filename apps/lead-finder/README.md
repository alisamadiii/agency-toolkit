# Lead Finder

Every morning this finds **10 new local businesses near Jacksonville, FL that have great Google reviews and no website**. It saves them to Neon Postgres and can post them to Discord. These leads become the spec websites that Ali Samadi Agency designs and pitches.

It has two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Scheduler service** (`scripts/scheduler.ts`) | Coolify | Runs once a day at the time set in the dashboard, and serves `GET /health` |
| **Dashboard** (Next.js + shadcn/ui) | Your laptop (`pnpm dev`) | Shows leads, reviews and photos, tracks status and design-ready, runs history, and holds the schedule, search and Discord settings |

Both parts use the same Neon database. When you change the run time in the local dashboard, the Coolify service picks it up within a minute.

## How a run works

1. The circle around home (radius in miles) is split into a grid of points 3 mi apart. There is one `search_cells` row per point × category. The least recently searched cells go first, so each day covers new ground.
2. For each cell, the run calls Places API (New) `places:searchText` with a 2.5 mi `locationBias`, reading up to 3 pages.
3. A place is kept when all of these hold:
   - it is `OPERATIONAL`
   - it has no `websiteUri`, or its website is only a social or listing page (Facebook, Instagram, Yelp, Linktree, business.site, DoorDash, Square…). In that case the page is stored in `social_url`.
   - its rating ≥ the minimum
   - its review count ≥ the minimum
   - it is inside the radius (haversine distance)
   - it is not already in `leads`
4. Candidates are ranked by `rating × review_count`. Place Details (reviews, photos, hours…) is fetched for the top N only.
5. Leads are inserted with `ON CONFLICT DO NOTHING`. `details` older than 30 days is cleared for `new`/`skipped`/`hidden` leads, because Google's terms only allow keeping Place IDs long-term.
6. A Discord summary is sent if Discord is enabled, and the run is logged in `runs`.

Cost control: `max_api_calls_per_run` caps every request, retries included. Google 429 and 5xx responses are retried with backoff, and one failed request never stops the run.

## Setup

```bash
pnpm install
cp .env.example .env      # DATABASE_URL + GOOGLE_MAPS_API_KEY
pnpm db:migrate           # create the tables in Neon
pnpm dev                  # dashboard → http://localhost:3000
```

Open **Settings** and set:
- home location
- radius, rating and review thresholds, categories
- run time and timezone
- Discord webhook (optional; use **Send test** to check it)

Then use **Dry run** to preview what a run would find without saving anything.

Google Cloud: enable **Places API (New)** for the key.

## Environment

| Var | |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `GOOGLE_MAPS_API_KEY` | Places API (New) key. It is only sent in the `X-Goog-Api-Key` header and never logged. |

All other settings live in the database and are edited in the dashboard.

## Scripts

| Command | |
|---|---|
| `pnpm dev` | Local dashboard |
| `pnpm scheduler` | The production service: cron + `/health` |
| `pnpm worker` | One full run now |
| `pnpm worker --dry-run` | Search and print results; nothing is written or sent |
| `pnpm lead:status <place_id> <status>` | `new`, `designing`, `design_ready`, `contacted`, `won`, `lost`, `skipped`, `hidden`, `design-ready`, `not-design-ready` |
| `pnpm lead:refresh <place_id>` | Fetch fresh Place Details for one lead |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations. To change the schema: edit `src/db/schema.ts` → generate → commit → migrate. Never use `push`. |
| `pnpm test` | Vitest: social detection, haversine, grid, filter, timezone |

## Deploy to Coolify

1. **New resource → Application → this GitHub repo**, build pack **Dockerfile**.
2. Add the env vars `DATABASE_URL` and `GOOGLE_MAPS_API_KEY`.
3. Port **3000**. A domain is optional, since `/health` is the only route.
4. Deploy. On start, the container runs `drizzle-kit migrate` and then the scheduler. The logs should show `[scheduler] started`.

You don't need a Coolify Scheduled Task, because the service schedules itself from the database settings. Daylight saving time is handled through the IANA timezone.

`GET /health` returns:

```json
{ "ok": true, "enabled": true, "nextRunAt": "2026-11-20T13:00:00.000Z",
  "lastRun": { "status": "ok", "startedAt": "…", "newLeadsSaved": 10 } }
```

## Stack

Node 22 · TypeScript · pnpm · Next.js 16 · Tailwind v4 · shadcn/ui · Drizzle ORM · Neon · Zod · node-cron · Vitest
