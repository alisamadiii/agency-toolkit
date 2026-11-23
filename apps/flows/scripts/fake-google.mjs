// Tiny stand-in for Google OAuth + Calendar, for scripts/smoke-integrations.mjs.
// Run Flows with GOOGLE_OAUTH_BASE / GOOGLE_AUTH_URL / GOOGLE_USERINFO_URL / GOOGLE_API_BASE
// pointed here. Never used in production.
import http from 'node:http';

const PORT = Number(process.env.FAKE_GOOGLE_PORT || 3399);
const state = { events: new Map(), revoked: [], refreshes: 0, failRefresh: false, flakyOnce: new Set() };

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const read = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });

// A busy hour tomorrow 10:00-11:00 New York time.
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const busy = { id: 'busy1', summary: 'Busy', status: 'confirmed', start: { dateTime: `${tomorrow}T10:00:00-05:00` }, end: { dateTime: `${tomorrow}T11:00:00-05:00` } };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const body = await read(req);
    const p = url.pathname;
    if (p === '/__state') return send(res, 200, { events: [...state.events.values()], revoked: state.revoked, refreshes: state.refreshes });
    if (p === '/__fail-refresh') { state.failRefresh = true; return send(res, 200, {}); }
    if (p === '/auth') return send(res, 200, { note: 'consent screen' });
    if (p === '/token') {
      const f = new URLSearchParams(body);
      if (f.get('grant_type') === 'authorization_code') {
        if (f.get('code') !== 'good-code' || !f.get('code_verifier')) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: 'fake-access-1', refresh_token: 'fake-refresh-1', expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly' });
      }
      if (f.get('grant_type') === 'refresh_token') {
        if (state.failRefresh) return send(res, 400, { error: 'invalid_grant' });
        state.refreshes++;
        return send(res, 200, { access_token: `fake-access-r${state.refreshes}`, expires_in: 3600 });
      }
      return send(res, 400, { error: 'unsupported' });
    }
    if (p === '/revoke') { state.revoked.push(new URLSearchParams(body).get('token')); return send(res, 200, {}); }
    if (p === '/userinfo') return send(res, 200, { email: 'owner@fake.test', name: 'Fake Owner' });

    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer fake-access')) return send(res, 401, { error: { message: 'bad token' } });
    let m;
    if ((m = p.match(/^\/calendar\/v3\/users\/me\/calendarList\/(.+)$/))) return send(res, 200, { id: decodeURIComponent(m[1]), timeZone: 'America/New_York' });
    if (p === '/calendar/v3/users/me/calendarList') return send(res, 200, { items: [{ id: 'owner@fake.test', summary: 'Owner', primary: true, timeZone: 'America/New_York' }] });
    if ((m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/))) {
      if (req.method === 'GET') return send(res, 200, { items: [busy, ...state.events.values()] });
      const ev = JSON.parse(body);
      if (state.events.has(ev.id)) return send(res, 409, { error: { message: 'duplicate' } });
      const stored = { ...ev, status: 'confirmed', htmlLink: `https://calendar.fake/${ev.id}`, hangoutLink: ev.conferenceData ? 'https://meet.fake/abc' : undefined };
      state.events.set(ev.id, stored);
      // First attempt of a "flaky" event: stored, but the response is lost.
      if (String(ev.summary).includes('flaky') && !state.flakyOnce.has(ev.id)) { state.flakyOnce.add(ev.id); return send(res, 503, { error: { message: 'try again' } }); }
      return send(res, 200, stored);
    }
    if ((m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      const id = decodeURIComponent(m[2]);
      if (req.method === 'DELETE') { return state.events.delete(id) ? send(res, 204, {}) : send(res, 410, {}); }
      return state.events.has(id) ? send(res, 200, state.events.get(id)) : send(res, 404, { error: { message: 'not found' } });
    }
    send(res, 404, { error: { message: `fake: no route ${p}` } });
  })
  .listen(PORT, () => console.log(`fake google on :${PORT}`));
