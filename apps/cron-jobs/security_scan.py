#!/usr/bin/env python3
"""
Weekly security / exposure scan for each client domain, via a Web Check
instance (https://github.com/Lissy93/web-check), analyzed by Claude.

For every enabled site it pulls the exposure-relevant checks from Web Check's
JSON API (open ports, DNS/mail records, SSL/TLS, security headers, cookies,
security.txt, firewall, tech stack, whois, breaches, blocklists, subdomains),
hands the bundle to Claude, and posts a short per-domain risk read to Discord.

This is attack-surface review, NOT secret scanning: it flags what an attacker
can enumerate (spoofable mail, open ports, missing headers, expiring certs,
leaked server versions), not leaked passwords.

Standard library only. Reuses helpers from check_sites.py.

Usage:
  python3 security_scan.py            # scan all enabled sites, post to Discord
  python3 security_scan.py --dry-run  # print the embeds, don't post

Env:
  WEBCHECK_URL          required, base URL of the Web Check instance
                        (e.g. http://web-check:3000 or https://web-check.xyz)
  WEBCHECK_PUBLIC_URL   optional, UI base for the "Open report" link
                        (default: WEBCHECK_URL)
  DISCORD_WEBHOOK_URL   required (except --dry-run)
  CLAUDE_BIN            optional path to the claude CLI
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

import check_sites as c

# Exposure/posture checks only. Skips heavy/cosmetic ones (screenshot, carbon,
# rank, social, trackers, archives, sitemap, linked-pages).
SECURITY_CHECKS = [
    "ports", "dns", "dnssec", "txt-records", "mail-config", "caa-records",
    "ssl", "tls-connection", "hsts", "headers", "http-security", "cookies",
    "security-txt", "firewall", "tech-stack", "whois", "breaches", "threats",
    "block-lists", "subdomains",
]

CHECK_TIMEOUT = 25          # per Web Check API call
MAX_FIELD = 4000            # trim any single check's JSON before sending to AI

SEV_FROM_WORD = {"high": c.SEV_DOWN, "medium": c.SEV_WARN,
                 "low": c.SEV_OK, "ok": c.SEV_OK}

PROMPT = """You are a security analyst for Ali Samadi Agency, which builds and
hosts websites for local businesses. Below is the raw output of an automated
external recon scan (Web Check) for ONE client domain: {domain}.

Assess the ATTACK SURFACE an outsider can see. Call out concrete risks, worst
first, and the fix for each. Look especially for:
- Mail that can be spoofed (missing/weak SPF, DMARC p=none, no DKIM).
- Open or unexpected ports, exposed admin/database services.
- SSL/TLS problems or a certificate expiring soon.
- Missing security headers (HSTS, CSP, X-Frame-Options) and insecure cookies.
- Leaked server/software versions or tech that invites known exploits.
- The domain or its emails showing up in known breaches.
- Blocklist/threat hits that hurt deliverability or reputation.

Rules:
- FIRST LINE must be exactly: SEVERITY: high | medium | low | ok
  high = actively exploitable or client-impacting now; medium = should fix
  soon; low = minor hardening; ok = nothing notable.
- Then a short Discord message (under 1200 chars), markdown bullets, each with
  the risk and the concrete next step. No preamble, no sign-off.
- Ignore fields that are empty, errored, or just informational.

SCAN DATA (JSON):
{data}
"""


def wait_for_webcheck(base, timeout=90):
    """Web Check needs ~30s to boot after a deploy; wait until it answers."""
    url = base.rstrip("/") + "/"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": c.USER_AGENT})
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    return True
        except Exception:  # noqa: BLE001
            pass
        print("Waiting for Web Check to come up...", flush=True)
        time.sleep(5)
    return False


def fetch_check(base, check, domain):
    url = f"{base.rstrip('/')}/api/{check}?url={urllib.parse.quote(domain)}"
    req = urllib.request.Request(url, headers={"User-Agent": c.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=CHECK_TIMEOUT) as resp:
            raw = resp.read(200_000).decode("utf-8", errors="ignore")
        return json.loads(raw)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        return {"_error": str(e)}


def gather(base, domain):
    data = {}
    for check in SECURITY_CHECKS:
        result = fetch_check(base, check, domain)
        # drop empty/errored checks so the AI prompt stays focused
        if isinstance(result, dict) and (result.get("_error") or
                                         result.get("skipped")):
            continue
        blob = json.dumps(result, separators=(",", ":"))
        data[check] = blob[:MAX_FIELD]
        print(f"  {domain} :: {check}: {len(blob)} bytes", flush=True)
    return data


def parse_severity(text):
    first = text.splitlines()[0].lower() if text else ""
    for word, sev in SEV_FROM_WORD.items():
        if word in first:
            return sev, "\n".join(text.splitlines()[1:]).strip() or text
    return c.SEV_WARN, text          # unknown -> treat as worth a look


def scan_site(base, public_base, site, stamp):
    domain = urllib.parse.urlparse(site["url"]).hostname or site["url"]
    print(f"Scanning {site['name']} ({domain})...", flush=True)
    data = gather(base, domain)
    if not data:
        return None
    note = c.run_claude(PROMPT.format(domain=domain,
                                      data=json.dumps(data, indent=1)),
                        timeout=240)
    if not note:
        return {
            "title": f"{site['name']} — scan done (AI unavailable)",
            "url": f"{public_base.rstrip('/')}/check/{domain}",
            "color": c.SEV_COLOR[c.SEV_WARN],
            "description": f"Pulled {len(data)} checks but Claude couldn't "
                           f"summarize. Open the report to review.",
            "footer": {"text": f"web-check scan | {c.human_time(stamp)}"},
        }
    sev, body = parse_severity(note)
    tag = {c.SEV_DOWN: "high risk", c.SEV_WARN: "needs attention",
           c.SEV_OK: "clean"}[sev]
    return {
        "title": f"{site['name']} — {tag}",
        "url": f"{public_base.rstrip('/')}/check/{domain}",
        "color": c.SEV_COLOR[sev],
        "description": body[:4096],
        "footer": {"text": f"web-check scan | {c.human_time(stamp)}"},
    }


def main():
    args = set(sys.argv[1:])
    dry_run = "--dry-run" in args
    base = os.environ.get("WEBCHECK_URL", "").strip()
    public_base = os.environ.get("WEBCHECK_PUBLIC_URL", "").strip() or base
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not base:
        sys.exit("Set WEBCHECK_URL (the Web Check instance base URL).")
    if not webhook and not dry_run:
        sys.exit("Set DISCORD_WEBHOOK_URL (or use --dry-run).")

    if not wait_for_webcheck(base):
        sys.exit(f"Web Check at {base} did not become ready; scan aborted.")

    stamp = datetime.now().isoformat(timespec="minutes")
    embeds = []
    for site in c.load_sites():
        embed = scan_site(base, public_base, site, stamp)
        if embed:
            embeds.append(embed)

    if not embeds:
        # exit non-zero so the dashboard shows a failed run, not a silent no-op
        sys.exit("No scan results: every Web Check call failed. Is web-check up?")

    # Discord caps at 10 embeds per message; chunk if needed.
    for i in range(0, len(embeds), 10):
        chunk = embeds[i:i + 10]
        if dry_run:
            print("\n--- Discord embeds ---\n"
                  + json.dumps(chunk, indent=2, ensure_ascii=False))
        else:
            c.post_discord(webhook, embeds=chunk)


if __name__ == "__main__":
    main()
