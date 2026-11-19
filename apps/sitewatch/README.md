# Website Tracker

Self-hosted monitoring for client websites. Add a domain — that's the whole
setup — and it:

- pings the site every 5 minutes (down/up alerts after 2 consecutive failures)
- crawls every page from the public sitemap daily in headless Chromium
- checks: broken images, failed CDN assets, mixed content, dead buttons,
  console errors, SEO basics, security headers, redirect hygiene, soft-404s,
  SSL + domain expiry, SPF/DMARC, stale copyright years, broken outbound links
- optionally tests the contact form and quote API end-to-end without emailing
  the client (see `HEALTHCHECK.md`)
- alerts through Discord / Slack / Telegram / email on new problems and
  recoveries — state changes only, no repeats

## Local development

```bash
pnpm install
pnpm exec playwright install chromium   # one-time browser download
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env                    # fill BETTER_AUTH_SECRET
pnpm db:migrate
pnpm dev
```

The scheduler runs inside the Next.js server process (started from
`src/instrumentation.ts`): uptime pulse every 5 minutes, deep crawl and
retention once per day. The **Run check now** button triggers a full crawl on
demand. Jobs can also be forced via
`POST /api/cron/{uptime-pulse|deep-crawl|retention}?force=1` with the
`x-cron-secret` header.

## Full local stack in Docker

```bash
docker compose up --build
```

## Deploy (Coolify)

Create a Docker Compose resource pointing at `coolify.compose.yml`. The
scheduler starts with the container — no external cron needed. Migrations run
automatically at boot (`docker/entrypoint.sh`).

## Schema changes

```bash
pnpm db:generate   # writes drizzle/XXXX_*.sql from src/db/schema.ts
pnpm db:migrate    # applies locally; prod applies at container boot
```
