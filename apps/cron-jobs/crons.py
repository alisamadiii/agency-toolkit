#!/usr/bin/env python3
"""
Cron registry for the cron-jobs umbrella.

Each cron is one Cron(...) entry below. To add a cron: append an entry and set
its env vars (including its own Discord webhook) in Coolify. Nothing is created
from the dashboard; the dashboard only views crons and runs existing ones.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Cron:
    id: str                  # stable key, used in status.json and the dashboard
    title: str               # label on the card
    description: str         # one line on the card
    argv: tuple              # script + args; .py paths resolve against this dir
    webhook_env: str         # NAME of the env var holding this cron's Discord webhook
    schedule: dict           # {"type":"interval","hours":N} | {"type":"times","times":[...]}
    enabled: bool = True
    interval_env: str = ""   # optional env that overrides interval hours
    gated_on_env: str = ""   # optional: skip the cron unless this env var is non-empty
    flag_env: str = ""       # optional: when this env == "true", append flag_arg to argv
    flag_arg: str = ""


CRONS = [
    Cron(
        id="site-uptime",
        title="Site uptime",
        description="HTTP status, SSL, DNS and load time for every client site; Discord alert on change.",
        argv=("check_sites.py",),
        webhook_env="UPTIME_WEBHOOK_URL",
        schedule={"type": "interval", "hours": 2},
        interval_env="CHECK_EVERY_HOURS",
        flag_env="DAILY_SUMMARY",
        flag_arg="--summary",
    ),
    Cron(
        id="security-scan",
        title="Security scan",
        description="Weekly external attack-surface scan of each domain via Web Check, summarized by Claude.",
        argv=("security_scan.py",),
        webhook_env="SECURITY_WEBHOOK_URL",
        schedule={"type": "interval", "hours": 168},
        interval_env="SECURITY_EVERY_HOURS",
        gated_on_env="WEBCHECK_URL",
    ),
]


def schedule_hours(cron):
    """Interval hours, overridable by interval_env. 0 for a times-based cron."""
    if cron.schedule.get("type") != "interval":
        return 0.0
    hours = float(cron.schedule.get("hours", 0))
    if cron.interval_env:
        raw = os.environ.get(cron.interval_env, "").strip()
        try:
            v = float(raw)
            if v > 0:
                hours = v
        except ValueError:
            pass
    return hours


def schedule_times(cron):
    if cron.schedule.get("type") == "times":
        return list(cron.schedule.get("times", []))
    return []


def is_gated_off(cron):
    return bool(cron.gated_on_env) and not os.environ.get(cron.gated_on_env, "").strip()


def schedule_desc(cron):
    if cron.schedule.get("type") == "times":
        return "at " + ",".join(schedule_times(cron))
    h = schedule_hours(cron)
    if h and h % 24 == 0:
        d = int(h // 24)
        return "daily" if d == 1 else f"every {d}d"
    if h == int(h):
        return f"every {int(h)}h"
    return f"every {h:g}h"
