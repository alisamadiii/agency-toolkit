# Agency Toolkit

The self-hosted tools I use to run a small web agency: finding leads, calling them, watching client sites, running scheduled checks, and keeping client accounts apart. Each one lives in its own folder under `apps/` and runs on its own.

| App | What it does | Stack |
|---|---|---|
| [lead-finder](apps/lead-finder) | Finds local businesses every day that have good Google reviews and no website. Saves them to Postgres and can post them to Discord. | Next.js, Drizzle, Postgres |
| [call-tracker](apps/call-tracker) | A cold-calling workspace: scans an industry, lists the leads, records the calls, and tracks status and notes for each day. | Vite, React, Node, lowdb |
| [sitewatch](apps/sitewatch) | Website monitoring with uptime pulses, a daily crawl for broken images, SEO, SSL/domain expiry and dead links, plus endpoint checks. Sends alerts to Discord, Slack, Telegram or email. | Next.js, Drizzle, Postgres, Playwright |
| [cron-jobs](apps/cron-jobs) | One container that runs scheduled jobs (site uptime, weekly security scan), each posting to Discord, with a small dashboard. | Python (stdlib only), Docker |
| [flows](apps/flows) | Self-hosted cron jobs and multi-step workflows (HTTP calls and sandboxed scripts) behind an API-key REST API, with one workspace per client. Built for the client hub. | Next.js, Drizzle, Postgres, Deno |
| [email-tracker](apps/email-tracker) | Tracks which email address you used for which service, plus subscriptions and renewal dates. | Next.js, Drizzle, Better Auth |
| [clients-browser](apps/clients-browser) | A native macOS browser with one isolated profile per client, and an encrypted backup to iCloud Drive. | Swift, SwiftUI, WebKit |
| [agency](apps/agency) | A native iOS hub of business tools. First tool: Review Cards, which turns a Google place into a review link and writes or verifies it on NFC cards. | Swift, SwiftUI, Core NFC, SwiftData |

## Getting started

The apps don't share code or dependencies. Pick one, `cd` into it and follow its README:

```bash
git clone https://github.com/alisamadiii/agency-toolkit.git
cd agency-toolkit/apps/sitewatch
cp .env.example .env
pnpm install && pnpm dev
```

Most web apps come with a `Dockerfile` and a `docker-compose.yml` / `coolify.compose.yml`. To deploy one on Coolify (or any other Docker host), set the build context to `apps/<name>`.

## License

[MIT](LICENSE)
