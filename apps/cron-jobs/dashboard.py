#!/usr/bin/env python3
"""
Private dashboard for the cron-jobs umbrella.

Served by the scheduler on a daemon thread (one container process). Shows every
cron and its status from /data/status.json, and offers a "Run now" button per
cron that triggers an immediate run.

Access: this is reached at http://<vps-ip>:<DASHBOARD_PORT> with no TLS. Put a
provider firewall in front of the port AND set DASHBOARD_USER / DASHBOARD_PASS.
The write endpoint (POST /api/run/<id>) is disabled unless those are set.
"""

import base64
import hmac
import http.server
import json
import os
import re
import threading

import runner

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", HERE)
STATUS_FILE = os.path.join(DATA_DIR, "status.json")
INDEX_FILE = os.path.join(HERE, "index.html")

_CRONS = {}
_RUN_RE = re.compile(r"^/api/run/([a-z0-9-]+)$")


def _auth_configured():
    return bool(os.environ.get("DASHBOARD_USER") and os.environ.get("DASHBOARD_PASS"))


def _auth_ok(header):
    """True when no creds are configured (viewing open) or the header matches."""
    if not _auth_configured():
        return True
    if not header or not header.startswith("Basic "):
        return False
    want = "Basic " + base64.b64encode(
        f"{os.environ['DASHBOARD_USER']}:{os.environ['DASHBOARD_PASS']}".encode()
    ).decode()
    return hmac.compare_digest(header, want)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep container logs clean
        pass

    def _send(self, code, body, ctype):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _deny(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="cron-jobs"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/healthz":
            return self._send(200, "ok", "text/plain")   # no auth, for healthchecks
        if not _auth_ok(self.headers.get("Authorization")):
            return self._deny()
        if path == "/api/status":
            try:
                with open(STATUS_FILE, "rb") as f:
                    body = f.read()
            except OSError:
                body = b'{"updated_at":null,"crons":{},"starting":true}'
            return self._send(200, body, "application/json")
        if path.startswith("/api/history/"):
            body = json.dumps(runner.read_history(path[len("/api/history/"):]))
            return self._send(200, body, "application/json")
        if path in ("/", "/index.html"):
            try:
                with open(INDEX_FILE, "rb") as f:
                    body = f.read()
            except OSError:
                body = b"<h1>cron-jobs</h1><p>dashboard file missing</p>"
            return self._send(200, body, "text/html; charset=utf-8")
        return self._send(404, "not found", "text/plain")

    def do_POST(self):
        if not _auth_ok(self.headers.get("Authorization")):
            return self._deny()
        m = _RUN_RE.match(self.path.split("?")[0])
        if not m:
            return self._send(404, '{"error":"not found"}', "application/json")
        if not _auth_configured():
            return self._send(
                403,
                '{"error":"set DASHBOARD_USER and DASHBOARD_PASS to enable Run now"}',
                "application/json",
            )
        cron = _CRONS.get(m.group(1))
        if not cron or not cron.enabled:
            return self._send(404, '{"error":"unknown or disabled cron"}', "application/json")
        started = runner.trigger(cron, "manual")
        if not started:
            return self._send(409, '{"error":"already running"}', "application/json")
        return self._send(202, '{"status":"started"}', "application/json")


def start(crons):
    global _CRONS
    _CRONS = {c.id: c for c in crons}
    port = int(os.environ.get("DASHBOARD_PORT", "8080"))
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    gated = "on" if _auth_configured() else "OFF (Run now disabled, set DASHBOARD_USER/PASS)"
    print(f"[dashboard] serving on :{port} | auth {gated}", flush=True)
