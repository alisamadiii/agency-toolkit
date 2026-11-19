#!/usr/bin/env python3
"""
Cron-jobs scheduler. The single long-running process in the container.

- Loops over the registry in crons.py and runs each cron on its own schedule.
- Starts the dashboard HTTP server on a daemon thread (so one process serves both).
- Records every run in /data/status.json (via runner), so cadence survives restarts
  and the dashboard always has data.

Env:
  TZ             timezone, default America/New_York
  RUN_ON_START   "true" = run every due cron once right after a deploy
  DASHBOARD_PORT dashboard port, default 8080
  (per-cron schedule overrides + webhooks live in crons.py / the cron's env vars)
"""

import os
import time
from datetime import datetime, timedelta

import crons as crons_mod
from crons import CRONS
import dashboard
import runner

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(os.environ.get("TZ", "America/New_York"))
except Exception:  # noqa: BLE001
    TZ = None


def now():
    return datetime.now(TZ) if TZ else datetime.now()


def log(msg):
    print(f"[{now():%Y-%m-%d %H:%M %Z}] {msg}", flush=True)


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def next_time_after(n, times):
    cands = []
    for t in times:
        h, m = (int(x) for x in t.split(":"))
        run = n.replace(hour=h, minute=m, second=0, microsecond=0)
        if run <= n:
            run += timedelta(days=1)
        cands.append(run)
    return min(cands) if cands else n + timedelta(hours=24)


def compute_next(cron, n):
    if cron.schedule.get("type") == "times":
        return next_time_after(n, crons_mod.schedule_times(cron))
    return n + timedelta(hours=crons_mod.schedule_hours(cron))


def active_crons():
    return [c for c in CRONS if c.enabled and not crons_mod.is_gated_off(c)]


def seed_next_runs(n, run_on_start):
    status = runner.read_status()
    nexts = {}
    for c in active_crons():
        last = parse_iso(status.get("crons", {}).get(c.id, {}).get("last_run"))
        if run_on_start or last is None:
            nexts[c.id] = n                       # run promptly
        elif c.schedule.get("type") == "times":
            nexts[c.id] = next_time_after(n, crons_mod.schedule_times(c))
        else:
            nexts[c.id] = last + timedelta(hours=crons_mod.schedule_hours(c))
    return nexts


def init_status(next_runs):
    """Seed status.json so the dashboard shows every cron before the first run."""
    status = runner.read_status()
    for c in CRONS:
        entry = status["crons"].get(c.id, {})
        entry.update({
            "id": c.id, "title": c.title, "description": c.description,
            "schedule": crons_mod.schedule_desc(c), "enabled": c.enabled,
        })
        entry.setdefault("last_run", None)
        entry.setdefault("last_exit_code", None)
        entry.setdefault("duration_s", None)
        entry.setdefault("last_source", None)
        if entry.get("last_status") == "running":
            # no run survives a container restart (e.g. a redeploy); record it
            entry["last_status"] = "fail"
            runner.append_history(c, {
                "at": now().isoformat(timespec="seconds"),
                "source": entry.get("last_source"), "status": "fail",
                "exit_code": None, "duration_s": None,
                "log": "Interrupted: the container restarted (redeploy) while this run was in progress.",
            })
        if not c.enabled:
            entry["last_status"] = "disabled"
            entry["next_run"] = None
        elif crons_mod.is_gated_off(c):
            entry["last_status"] = entry.get("last_status") or "paused"
            entry["next_run"] = None
        else:
            entry.setdefault("last_status", "never")
            if c.id in next_runs:
                entry["next_run"] = next_runs[c.id].isoformat(timespec="seconds")
        status["crons"][c.id] = entry
    runner.write_status(status)


def main():
    dashboard.start(CRONS)
    n = now()
    run_on_start = os.environ.get("RUN_ON_START", "").lower() == "true"
    next_runs = seed_next_runs(n, run_on_start)
    init_status(next_runs)
    gated = [c.id for c in CRONS if c.enabled and crons_mod.is_gated_off(c)]
    log(f"Scheduler started. Active: {[c.id for c in active_crons()]}"
        + (f" | gated off: {gated}" if gated else ""))
    while True:
        n = now()
        for c in active_crons():
            due = next_runs.get(c.id)
            if due and n >= due:
                nxt = compute_next(c, n)
                runner.trigger(c, "schedule", next_run=nxt)   # runner logs start/finish
                next_runs[c.id] = nxt
        time.sleep(30)


if __name__ == "__main__":
    main()
