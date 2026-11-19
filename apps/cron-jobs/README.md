# Cron Jobs

One always-on container on Coolify that runs scheduled tasks ("crons") for the
agency, each posting to its own Discord channel, plus a small private dashboard
to see them and run any of them on demand. Everything is plain Python standard
library: no framework, no build step.

Crons today:

| Cron | What it does | Schedule | Discord webhook env |
|---|---|---|---|
| `site-uptime` | HTTP status, SSL, DNS, load time and content checks for every client site. Alerts only on change, with a short "still unresolved" nudge otherwise. | every 2h | `UPTIME_WEBHOOK_URL` |
| `security-scan` | External attack-surface scan of each domain via a bundled Web Check, summarized by Claude. | weekly | `SECURITY_WEBHOOK_URL` |

## The dashboard

`http://<vps-ip>:18080` — one card per cron with a color status, last/next run,
duration, a **Run now** button, and a **History** toggle that lists the last 50 runs
(click a run to see its output). It only shows and runs existing crons; new crons are
added in code (below), never from the page.

**Keep it private.** It is served over plain HTTP on a raw port, so:

1. **Set `DASHBOARD_USER` and `DASHBOARD_PASS`** in Coolify. The page asks for them,
   and the Run-now button is disabled until they are set.
2. **Allow-list your IP to port 18080 in the Hostinger VPS firewall.** Do not rely on
   `ufw` on the host: Docker publishes ports through its own iptables chains, which
   bypass `ufw`. The provider firewall sits upstream of Docker and actually holds.

**Opening it without touching the firewall:** tunnel the port over SSH (port 22 is already
open to you), then browse `http://localhost:18080`:

```bash
ssh -L 18080:localhost:18080 root@2.25.105.158
```

Login: user `ali`, password = Coolify → cron-jobs → Environment Variables → `DASHBOARD_PASS`.

Change the host port with `DASHBOARD_HOST_PORT` (default `18080`; `8080` is taken by Coolify).

## Adding a cron

1. Write the script (a plain `python3 script.py` that posts to Discord via the
   `DISCORD_WEBHOOK_URL` env var; reuse `post_discord` from `check_sites.py`).
2. Append one entry to `CRONS` in [`crons.py`](crons.py):

   ```python
   Cron(
       id="my-task",
       title="My task",
       description="One line shown on the dashboard.",
       argv=("my_task.py",),
       webhook_env="MYTASK_WEBHOOK_URL",      # this cron's own Discord webhook
       schedule={"type": "interval", "hours": 24},
       # or: schedule={"type": "times", "times": ["08:00", "17:00"]}
   )
   ```
3. Add the script to the `COPY` line in the `Dockerfile`.
4. In Coolify, add `MYTASK_WEBHOOK_URL` (and any env vars the script needs), then **Redeploy**.

Optional fields: `enabled=False` to park a cron, `interval_env="SOME_ENV"` to let an
env var override the hours, `gated_on_env="SOME_ENV"` to skip the cron unless that
env var is set, `flag_env`/`flag_arg` to append a CLI flag when an env var is `true`.

## How scheduling works

`scheduler.py` is the container's single process. It loops over the registry, runs each
cron on its own schedule (as a subprocess, with that cron's webhook injected as
`DISCORD_WEBHOOK_URL`), and records every run in `/data/status.json`. Because the last
run time is persisted, a redeploy resumes the cadence instead of re-firing everything.
A per-cron lock means a Run-now click can never overlap a scheduled run.

`RUN_ON_START=true` runs every cron once right after a deploy (handy for a first test);
set it back to `false` afterwards.

## Environment variables

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | token from `claude setup-token`, used for AI summaries |
| `UPTIME_WEBHOOK_URL` | Discord webhook for the uptime cron |
| `SECURITY_WEBHOOK_URL` | Discord webhook for the security cron |
| `DISCORD_WEBHOOK_URL` | fallback used by any cron whose own webhook is empty |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | dashboard login; required for Run now |
| `DASHBOARD_HOST_PORT` | host port for the dashboard, default `18080` |
| `SITES` | optional override of `sites.json` for the uptime cron (empty = use the file) |
| `CHECK_EVERY_HOURS` | override the uptime interval (default 2) |
| `DAILY_SUMMARY` | `true` = full report on every uptime run instead of change-only alerts |
| `WEBCHECK_URL` | Web Check base URL, default `http://web-check:3000` (empty = scan off) |
| `WEBCHECK_PUBLIC_URL` | optional public URL for "Open report" links in Discord |
| `SECURITY_EVERY_HOURS` | override the scan interval (default 168) |
| `TZ` | default `America/New_York` |
| `RUN_ON_START` | `true` = run every cron right after deploy |

## Site uptime cron

Sites live in `sites.json` (gitignored). Start from the example:
`cp sites.example.json sites.json`. Without it, the cron uses
[`sites.example.json`](sites.example.json). Each entry is `{"name", "url"}` plus optional
`must_contain` (text that must appear on the page), `notes` (context for Claude), and
`"enabled": false` to pause a site without deleting it. Or set the `SITES` env var.

It checks DNS, HTTP status, wrong-domain redirects, load time (warns over 8s), nearly
empty pages, the `must_contain` text, and SSL validity/expiry (warns within 14 days). A
failing site is re-checked after 30 seconds before alerting. It remembers what it already
told you: something new breaks → full detail with Claude's cause and next step; a problem
clears → a green "fixed" note; nothing changed → one short "still unresolved" line; all
fine → silence.

Run it by hand from the Coolify **Terminal** tab:

```bash
python3 check_sites.py --summary   # full report now, also saves history
python3 check_sites.py --dry-run   # print, don't post
```

## Security scan cron

Pulls exposure-relevant checks from the bundled `web-check` service (open ports, DNS and
mail records, SSL/TLS, security headers, cookies, whois, breaches, blocklists,
subdomains), hands them to Claude, and posts a severity-colored card per domain. This is
attack-surface review, not secret scanning. `web-check` is internal only: give it no
domain in Coolify.

```bash
python3 security_scan.py --dry-run
```

## A limit worth knowing

This runs on the same VPS as Coolify. If the whole server goes down, it can't tell you.
For sites hosted on this VPS, a free external pinger such as UptimeRobot is a good backup.
