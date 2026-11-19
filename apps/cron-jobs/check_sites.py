#!/usr/bin/env python3
"""
AI-powered daily client-website monitor -> Discord.

1. Collects hard facts for each site in sites.json:
   HTTP status, redirects, load time, page title, page size, server,
   SSL certificate expiry, DNS, and an optional must-contain keyword.
2. Keeps a short history (history.json) so trends can be spotted
   ("down since yesterday", "load time tripled this week").
3. When something is wrong, it asks Claude (the Claude Code CLI, `claude -p`)
   to write a short, helpful Discord message: what's wrong, the likely cause,
   and what to do next. If Claude is unavailable, a plain alert is sent instead,
   so you never miss an outage.

Standard library only. Requires the `claude` CLI on the server for AI messages.

Usage:
  python3 check_sites.py            # check; AI alert to Discord only if issues
  python3 check_sites.py --summary  # always post (AI daily summary even if all OK)
  python3 check_sites.py --test     # send a test Discord message
  python3 check_sites.py --dry-run  # print results + AI message, don't post

Env:
  DISCORD_WEBHOOK_URL   required (except --dry-run)
  CLAUDE_BIN            optional path to the claude CLI (default: "claude")
"""

import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
SITES_FILE = os.path.join(HERE, "sites.json")
if not os.path.exists(SITES_FILE):  # fresh clone: fall back to the example list
    SITES_FILE = os.path.join(HERE, "sites.example.json")
DATA_DIR = os.environ.get("DATA_DIR", HERE)
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
STATE_FILE = os.path.join(DATA_DIR, "alert_state.json")  # last-reported problems per site

SLOW_SECONDS = 8
SSL_WARN_DAYS = 14
TIMEOUT = 20
RETRY_DELAY = 30
HISTORY_KEEP = 14          # runs kept per site
AI_TIMEOUT = 180           # seconds to wait for Claude
USER_AGENT = "Mozilla/5.0 (compatible; AliSamadiSiteMonitor/2.0)"
DISCORD_LIMIT = 1900       # stay under Discord's 2000-char message limit

# severity of a problem, worst wins for a site's embed color
SEV_OK, SEV_WARN, SEV_DOWN = 0, 1, 2
SEV_COLOR = {SEV_OK: 0x2ECC71, SEV_WARN: 0xE67E22, SEV_DOWN: 0xE74C3C}
SEV_SECTION = {SEV_DOWN: ("🔴", "Down"), SEV_WARN: ("🟠", "Warnings")}
AI_COLOR = 0x5865F2        # blurple, for the AI analysis embed


# ---------------------------------------------------------------- checks

def load_sites():
    # SITES env var wins (easy to edit in Coolify): a JSON list, or a simple
    # comma/newline-separated list of domains. Falls back to sites.json.
    raw = os.environ.get("SITES", "").strip()
    if raw.startswith("["):
        data = json.loads(raw)
    elif raw:
        data = [s.strip() for s in re.split(r"[,\n]", raw) if s.strip()]
    else:
        with open(SITES_FILE, encoding="utf-8") as f:
            data = json.load(f)
    sites = []
    for entry in data:
        if isinstance(entry, str):
            entry = {"url": entry}
        # "enabled": false pauses a site without removing it
        if not entry.get("enabled", True):
            continue
        url = entry["url"]
        if not url.startswith("http"):
            url = "https://" + url
        entry["url"] = url
        entry.setdefault("name", urlparse(url).hostname)
        sites.append(entry)
    return sites


def check_dns(host):
    try:
        return sorted({a[4][0] for a in socket.getaddrinfo(host, 443)}), None
    except socket.gaierror as e:
        return [], f"DNS lookup failed: {e}"


def check_http(site):
    info = {"status": None, "final_url": None, "elapsed": None,
            "title": None, "bytes": None, "server": None}
    problems = []
    req = urllib.request.Request(site["url"], headers={"User-Agent": USER_AGENT})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read(2_000_000).decode("utf-8", errors="ignore")
            info["status"] = resp.status
            info["final_url"] = resp.geturl()
            info["server"] = resp.headers.get("Server")
    except urllib.error.HTTPError as e:
        info["status"] = e.code
        info["elapsed"] = round(time.monotonic() - start, 2)
        info["server"] = e.headers.get("Server") if e.headers else None
        return info, [f"HTTP {e.code} {e.reason}"]
    except urllib.error.URLError as e:
        info["elapsed"] = round(time.monotonic() - start, 2)
        return info, [f"Unreachable: {e.reason}"]
    except (socket.timeout, TimeoutError):
        info["elapsed"] = TIMEOUT
        return info, [f"Timed out after {TIMEOUT}s"]
    except Exception as e:  # noqa: BLE001
        info["elapsed"] = round(time.monotonic() - start, 2)
        return info, [f"Error: {e}"]

    info["elapsed"] = round(time.monotonic() - start, 2)
    info["bytes"] = len(body)
    m = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
    info["title"] = re.sub(r"\s+", " ", m.group(1)).strip()[:120] if m else None

    if info["elapsed"] > SLOW_SECONDS:
        problems.append(f"Slow: {info['elapsed']}s to load")
    if info["bytes"] < 500:
        problems.append(f"Page is nearly empty ({info['bytes']} bytes)")
    keyword = site.get("must_contain")
    if keyword and keyword.lower() not in body.lower():
        problems.append(f'Expected text "{keyword}" not found on page')
    if urlparse(info["final_url"]).hostname != urlparse(site["url"]).hostname:
        problems.append(f"Redirects to a different domain: {info['final_url']}")
    return info, problems


def check_ssl(host, port=443):
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=TIMEOUT) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                cert = ssock.getpeercert()
    except ssl.SSLCertVerificationError as e:
        return None, [f"SSL certificate invalid: {e.verify_message}"]
    except Exception as e:  # noqa: BLE001
        return None, [f"SSL check failed: {e}"]
    expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), tz=timezone.utc)
    days = (expires - datetime.now(timezone.utc)).days
    if days < 0:
        return days, [f"SSL certificate EXPIRED {abs(days)} days ago"]
    if days < SSL_WARN_DAYS:
        return days, [f"SSL certificate expires in {days} days"]
    return days, []


def check_site(site):
    parsed = urlparse(site["url"])
    host = parsed.hostname
    ips, dns_err = check_dns(host)
    result = {"name": site["name"], "url": site["url"], "ips": ips, "problems": []}
    if site.get("notes"):
        result["notes"] = site["notes"]
    if dns_err:
        result["problems"].append(dns_err)
        return result
    info, problems = check_http(site)
    result.update(info)
    result["problems"] += problems
    if parsed.scheme == "https":
        days, ssl_problems = check_ssl(host, parsed.port or 443)
        result["ssl_days_left"] = days
        result["problems"] += ssl_problems
    else:
        result["problems"].append("Not using HTTPS")
    return result


# ---------------------------------------------------------------- history

def load_history():
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_history(history, results, stamp):
    for r in results:
        runs = history.setdefault(r["url"], [])
        runs.append({"at": stamp, "status": r.get("status"), "elapsed": r.get("elapsed"),
                     "ssl_days_left": r.get("ssl_days_left"), "problems": r["problems"]})
        del runs[:-HISTORY_KEEP]
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=1)


# ---------------------------------------------------------------- AI message

PROMPT = """You are the website monitor for Ali Samadi Agency, a small web agency in
Jacksonville, FL that builds and maintains websites for local businesses.
Below are today's automated check results for the agency's client websites,
plus recent history for each site (oldest first).

The raw status (which site, which problems) is already shown to Ali as
structured cards, so DON'T re-list the checks. Write only the analysis Ali
can act on:
- For each affected site, one tight line: the most likely cause given the
  evidence (DNS, hosting down, expired SSL, slow server, bad redirect) and the
  concrete next step to take.
- Use the history to call out trends (how long a site has been down, load
  times getting worse, SSL expiry coming up, a problem that came back).
- Note whether the client is likely noticing (fully down vs. slightly slow).
- If everything is fine, give a short friendly all-clear with anything worth watching.
- Be concise: under 1200 characters. Discord markdown (**bold**, bullets).
  Lead each site with its **name** in bold. No preamble, no sign-off, output only the message.

Today: {today}

RESULTS:
{results}

HISTORY:
{history}
"""


def run_claude(prompt, timeout=AI_TIMEOUT):
    """Run the Claude CLI once in print mode. Returns text or None."""
    claude = os.environ.get("CLAUDE_BIN", "claude")
    if not shutil.which(claude):
        return None
    try:
        out = subprocess.run([claude, "-p", prompt], capture_output=True,
                             text=True, timeout=timeout)
    except Exception as e:  # noqa: BLE001
        print(f"AI call failed: {e}", file=sys.stderr)
        return None
    text = out.stdout.strip()
    if out.returncode != 0 or not text:
        print(f"AI call failed (exit {out.returncode}): {out.stderr[:300]}", file=sys.stderr)
        return None
    return text


def ai_message(results, history):
    today = datetime.now().strftime("%A %b %d, %Y %I:%M %p")
    hist = {r["name"]: history.get(r["url"], [])[-7:] for r in results}
    return run_claude(PROMPT.format(today=today,
                                    results=json.dumps(results, indent=1),
                                    history=json.dumps(hist, indent=1)))


# ---------------------------------------------------------------- embeds

def classify(problem):
    """Map a problem string to (category tag, severity)."""
    p = problem.lower()
    if p.startswith("slow:"):
        return "perf", SEV_WARN
    if "ssl" in p:
        return "ssl", SEV_DOWN if ("expired" in p or "invalid" in p) else SEV_WARN
    if p.startswith("redirects"):
        return "redirect", SEV_WARN
    if "nearly empty" in p:
        return "content", SEV_DOWN
    if "expected text" in p:
        return "content", SEV_WARN
    if "not using https" in p:
        return "security", SEV_WARN
    if p.startswith("http 4"):
        return "down", SEV_WARN
    if any(k in p for k in ("unreachable", "timed out", "dns lookup", "http 5", "error:")):
        return "down", SEV_DOWN
    return "down", SEV_DOWN


def worst_sev(result):
    return max((classify(p)[1] for p in result["problems"]), default=SEV_OK)


def site_embed(result, footer):
    groups = {}
    for p in result["problems"]:
        cat, sev = classify(p)
        groups.setdefault(sev, []).append(f"• `[{cat}]` {p}")
    lines = []
    for sev in (SEV_DOWN, SEV_WARN):
        items = groups.get(sev)
        if not items:
            continue
        emoji, label = SEV_SECTION[sev]
        lines.append(f"{emoji} **{label} ({len(items)})**")
        lines += items
        lines.append("")
    return {
        "title": result["name"],
        "url": result["url"],
        "color": SEV_COLOR[worst_sev(result)],
        "description": "\n".join(lines).strip()[:4096],
        "footer": {"text": footer},
    }


def allclear_embed(results, ai, footer):
    return {
        "title": f"✅ All {len(results)} sites up",
        "color": SEV_COLOR[SEV_OK],
        "description": (ai or "Every client site responded normally.")[:4096],
        "footer": {"text": footer},
    }


def ai_embed(text):
    return {"title": "🧠 What to do", "color": AI_COLOR, "description": text[:4096]}


def build_embeds(results, stamp, ai, want_summary):
    bad = sorted((r for r in results if r["problems"]),
                 key=worst_sev, reverse=True)
    down = sum(1 for r in bad if worst_sev(r) == SEV_DOWN)
    warn = sum(1 for r in results for p in r["problems"]
               if classify(p)[1] == SEV_WARN)
    footer = (f"Checked {len(results)} sites · {down} down, {warn} warnings"
              f" | {human_time(stamp)}")
    if not bad:
        return [allclear_embed(results, ai, footer)] if want_summary else []
    embeds = [site_embed(r, footer) for r in bad[:9]]
    if len(bad) > 9:
        embeds[-1]["footer"]["text"] += f" (+{len(bad) - 9} more)"
    if ai:
        embeds.append(ai_embed(ai))
    return embeds[:10]


def human_time(stamp):
    try:
        return datetime.fromisoformat(stamp).strftime("%b %d, %Y %I:%M %p")
    except ValueError:
        return stamp


def make_footer(results, stamp):
    down = sum(1 for r in results if worst_sev(r) == SEV_DOWN)
    warn = sum(1 for r in results for p in r["problems"]
               if classify(p)[1] == SEV_WARN)
    return (f"Checked {len(results)} sites · {down} down, {warn} warnings"
            f" | {human_time(stamp)}")


# ---------------------------------------------------------------- alert state

def load_alert_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_alert_state(results):
    state = {r["url"]: r["problems"] for r in results}
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=1)


def diff_sites(results, prev):
    """Per site: what's new and what got fixed since the last reported state."""
    changed = False
    out = []
    for r in results:
        before = set(prev.get(r["url"], []))
        now = set(r["problems"])
        new = [p for p in r["problems"] if p not in before]
        fixed = sorted(before - now)
        if new or fixed:
            changed = True
        out.append({"r": r, "new": new, "fixed": fixed})
    return changed, out


def change_embed(entry, footer):
    """Full detail for a site that changed: new problems + anything fixed."""
    r, new, fixed = entry["r"], entry["new"], entry["fixed"]
    groups = {}
    for p in new:
        cat, sev = classify(p)
        groups.setdefault(sev, []).append(f"• `[{cat}]` {p}")
    lines = []
    for sev in (SEV_DOWN, SEV_WARN):
        items = groups.get(sev)
        if not items:
            continue
        emoji, label = SEV_SECTION[sev]
        lines.append(f"{emoji} **New {label.lower()} ({len(items)})**")
        lines += items
        lines.append("")
    if fixed:
        lines.append(f"🟢 **Fixed ({len(fixed)})**")
        lines += [f"• {p}" for p in fixed]
        lines.append("")
    still = [p for p in r["problems"] if p not in new]
    if still:
        lines.append(f"ℹ️ **Still open ({len(still)})**")
        lines += [f"• {p}" for p in still]
    bits = []
    if new:
        bits.append(f"{len(new)} new")
    if fixed:
        bits.append(f"{len(fixed)} fixed")
    title = r["name"] + (" — " + ", ".join(bits) if bits else "")
    color = SEV_COLOR[worst_sev(r)] if r["problems"] else SEV_COLOR[SEV_OK]
    return {"title": title, "url": r["url"], "color": color,
            "description": "\n".join(lines).strip()[:4096], "footer": {"text": footer}}


def reminder_embed(results, footer):
    """Compact nudge when nothing changed and issues are still open."""
    down = sum(1 for r in results if worst_sev(r) == SEV_DOWN)
    warn = sum(1 for r in results for p in r["problems"]
               if classify(p)[1] == SEV_WARN)
    worst = max((worst_sev(r) for r in results), default=SEV_OK)
    parts = []
    if down:
        parts.append(f"**{down}** site{'s' if down != 1 else ''} down")
    if warn:
        parts.append(f"**{warn}** warning{'s' if warn != 1 else ''}")
    sites = ", ".join(r["name"] for r in results if r["problems"])
    return {
        "title": "⏳ Still unresolved",
        "color": SEV_COLOR[worst],
        "description": (f"Same {' and '.join(parts)} as the last check — nothing "
                        f"fixed yet.\nAffected: {sites}\nPlease fix ASAP."),
        "footer": {"text": footer},
    }


# ---------------------------------------------------------------- discord

def post_discord(webhook, content=None, embeds=None):
    payload = {}
    if content:
        payload["content"] = content[:DISCORD_LIMIT]
    if embeds:
        payload["embeds"] = embeds[:10]
    req = urllib.request.Request(
        webhook, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST")
    urllib.request.urlopen(req, timeout=TIMEOUT).close()


# ---------------------------------------------------------------- main

def main():
    args = set(sys.argv[1:])
    dry_run = "--dry-run" in args
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not webhook and not dry_run:
        sys.exit("Set DISCORD_WEBHOOK_URL (or use --dry-run).")

    if "--test" in args:
        post_discord(webhook, "✅ Site monitor is connected. You'll get alerts here.")
        print("Test message sent.")
        return

    results = []
    for site in load_sites():
        r = check_site(site)
        if r["problems"]:
            time.sleep(RETRY_DELAY)          # retry once to rule out a blip
            r = check_site(site)
        print(f"{r['name']}: " + ("; ".join(r["problems"]) or f"OK ({r.get('elapsed')}s)"))
        results.append(r)

    history = load_history()
    stamp = datetime.now().isoformat(timespec="minutes")
    want_summary = "--summary" in args
    footer = make_footer(results, stamp)

    prev = load_alert_state()
    changed, diffs = diff_sites(results, prev)
    total_open = sum(1 for r in results if r["problems"])

    embeds = []
    if want_summary:
        # manual/forced full report: every open site, or an all-clear
        ai = ai_message(results, history)
        embeds = build_embeds(results, stamp, ai, True)
    elif changed:
        # something broke or got fixed since last check -> full detail
        affected = sorted((d for d in diffs if d["new"] or d["fixed"]),
                          key=lambda d: worst_sev(d["r"]), reverse=True)
        embeds = [change_embed(d, footer) for d in affected[:9]]
        if any(d["new"] for d in affected):   # only pay for AI on new problems
            ai = ai_message(results, history)
            if ai:
                embeds.append(ai_embed(ai))
    elif total_open:
        # nothing changed but issues still open -> short nudge, no repeat detail
        embeds = [reminder_embed(results, footer)]

    save_history(history, results, stamp)
    if not dry_run:
        save_alert_state(results)

    if embeds:
        if dry_run:
            print("\n--- Discord embeds ---\n"
                  + json.dumps(embeds, indent=2, ensure_ascii=False))
        else:
            post_discord(webhook, embeds=embeds)


if __name__ == "__main__":
    main()
