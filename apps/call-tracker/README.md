# Call Tracker

Personal daily cold-call tool. Local only — never deployed.

## Daily flow

1. `npm run dev` → open http://localhost:5173
2. Pick up to 10 industries (checkboxes or custom), city is fixed in config (pencil icon to change)
3. Hit **Scan** → 20 leads per industry via Google Places (1 API call per industry, no pagination)
4. Call each lead from your phone, set status (new / no answer / callback / interested / not interested / won), add notes
5. Camera button on a lead → right panel opens, record yourself while dialing, **Save recording** writes the video to `recordings/YYYY-MM-DD/`

## Setup

```sh
npm install
echo 'GOOGLE_PLACES_API_KEY=...' > .env
npm run dev
```

## Data

- `data/db.json` — all days, leads, statuses, notes (plain JSON, gitignored, created on first run; see `data/db.example.json` for the shape)
- `recordings/` — call videos, **local only** (gitignored, GitHub 100MB limit); share manually
- Leads dedupe by `placeId` across all days — a rescan only adds businesses never seen before

## Stack

Vite + React + Tailwind v4 + shadcn/ui, Hono API on :8787 (Vite proxies `/api`), lowdb JSON persistence. Places/scan/scoring logic ported from the Portfolio monorepo leads app.
