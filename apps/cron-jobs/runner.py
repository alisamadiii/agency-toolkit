#!/usr/bin/env python3
"""
Runs a cron and records its status. Shared by the scheduler loop and the
dashboard "Run now" button, so both go through the same per-cron lock and the
same atomic status writer.
"""

import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime

import crons as crons_mod

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(os.environ.get("TZ", "America/New_York"))
except Exception:  # noqa: BLE001
    TZ = None

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", HERE)
STATUS_FILE = os.path.join(DATA_DIR, "status.json")
HISTORY_FILE = os.path.join(DATA_DIR, "runs.json")   # per-cron run history
HISTORY_KEEP = 50          # runs kept per cron
LOG_TAIL = 4000            # chars of output kept per run

_locks = {}
_lock_guard = threading.Lock()
_status_lock = threading.Lock()
_history_lock = threading.Lock()


def now():
    return datetime.now(TZ) if TZ else datetime.now()


def _lock_for(cron_id):
    with _lock_guard:
        return _locks.setdefault(cron_id, threading.Lock())


def read_status():
    try:
        with open(STATUS_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        data = {}
    data.setdefault("updated_at", None)
    data.setdefault("crons", {})
    return data


def write_status(status):
    status["updated_at"] = now().isoformat(timespec="seconds")
    tmp = STATUS_FILE + ".tmp"
    with _status_lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(status, f, indent=1)
        os.replace(tmp, STATUS_FILE)


def set_cron_fields(cron, **fields):
    status = read_status()
    entry = status["crons"].get(cron.id, {})
    entry.update({
        "id": cron.id,
        "title": cron.title,
        "description": cron.description,
        "schedule": crons_mod.schedule_desc(cron),
        "enabled": cron.enabled,
    })
    entry.update(fields)
    status["crons"][cron.id] = entry
    write_status(status)


def read_history(cron_id):
    """Recorded runs for one cron, newest first."""
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        data = {}
    return list(reversed(data.get(cron_id, [])))


def append_history(cron, record):
    with _history_lock:
        try:
            with open(HISTORY_FILE, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            data = {}
        runs = data.setdefault(cron.id, [])
        runs.append(record)
        del runs[:-HISTORY_KEEP]
        tmp = HISTORY_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1)
        os.replace(tmp, HISTORY_FILE)


def run_cron(cron):
    """Run the cron's command once with its own webhook injected. Blocking.
    Returns (exit_code, duration_s, output_tail)."""
    env = os.environ.copy()
    webhook = (os.environ.get(cron.webhook_env, "").strip()
               or os.environ.get("DISCORD_WEBHOOK_URL", "").strip())
    env["DISCORD_WEBHOOK_URL"] = webhook
    argv = [sys.executable]
    for a in cron.argv:
        argv.append(os.path.join(HERE, a) if a.endswith(".py") else a)
    if cron.flag_env and os.environ.get(cron.flag_env, "").lower() == "true" and cron.flag_arg:
        argv.append(cron.flag_arg)
    start = time.monotonic()
    proc = subprocess.run(argv, env=env, capture_output=True, text=True)
    dur = round(time.monotonic() - start, 1)
    out = (proc.stdout or "") + (("\n[stderr]\n" + proc.stderr) if proc.stderr else "")
    if out.strip():
        print(out.rstrip(), flush=True)      # keep it in the container logs too
    return proc.returncode, dur, out[-LOG_TAIL:]


def trigger(cron, source, next_run=None):
    """Start the cron in a worker thread unless it's already running.

    Returns True if started, False if a run of this cron is already in flight.
    `source` is "schedule" or "manual". `next_run` (datetime) is recorded for
    scheduled runs; manual runs leave the existing next_run untouched.
    """
    lock = _lock_for(cron.id)
    if not lock.acquire(blocking=False):
        return False
    set_cron_fields(cron, last_status="running", last_source=source)
    nxt = f"; next at {next_run:%a %b %d %H:%M}" if next_run is not None else ""
    print(f"[{now():%Y-%m-%d %H:%M %Z}] [{cron.id}] {source} run started{nxt}", flush=True)

    def worker():
        try:
            code, dur, tail = run_cron(cron)
            print(f"[{now():%Y-%m-%d %H:%M %Z}] [{cron.id}] {source} run finished "
                  f"(exit {code}, {dur}s)", flush=True)
            at = now().isoformat(timespec="seconds")
            append_history(cron, {"at": at, "source": source,
                                  "status": "ok" if code == 0 else "fail",
                                  "exit_code": code, "duration_s": dur, "log": tail})
            fields = {
                "last_run": at,
                "last_status": "ok" if code == 0 else "fail",
                "last_exit_code": code,
                "duration_s": dur,
                "last_source": source,
            }
            if next_run is not None:
                fields["next_run"] = next_run.isoformat(timespec="seconds")
            set_cron_fields(cron, **fields)
        finally:
            lock.release()

    threading.Thread(target=worker, daemon=True).start()
    return True
