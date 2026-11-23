// A stand-in for the client hub's flowsService tRPC routes, for local tests only.
// Run Flows with HUB_API_URL=http://localhost:3399 HUB_API_KEY=<FAKE_HUB_KEY> (see README).
//   POST /__setup { connected: [projectId], known: [projectId] }  → which projects exist / have a calendar
//   GET  /__calls                                                → every call received (for assertions)
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_HUB_PORT || 3399);
const KEY = process.env.FAKE_HUB_KEY || 'test-key-test-key-test-key-test-key';

let connected = new Set();
let known = new Set();
const calls = [];
const events = new Map(); // `${projectId}:${idempotencyKey}` → event

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const ok = (res, data) => send(res, 200, { result: { data } });
const err = (res, httpStatus, code, message) => send(res, httpStatus, { error: { message, code: -1, data: { code, httpStatus } } });

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/__setup') {
    const body = await readBody(req);
    connected = new Set(body.connected ?? []);
    known = new Set([...(body.known ?? []), ...connected]);
    calls.length = 0;
    events.clear();
    return ok(res, { ok: true });
  }
  if (url.pathname === '/__calls') return send(res, 200, calls);

  const m = url.pathname.match(/^\/api\/trpc\/flowsService\.(\w+)$/);
  if (!m) return err(res, 404, 'NOT_FOUND', 'No such procedure');
  const input = req.method === 'GET' ? JSON.parse(url.searchParams.get('input') ?? '{}') : await readBody(req);
  calls.push({ procedure: m[1], method: req.method, authorization: req.headers.authorization ?? null, input });

  if (req.headers.authorization !== `Bearer ${KEY}`) return err(res, 401, 'UNAUTHORIZED', 'Invalid service key');
  if (!known.has(input.projectId)) return err(res, 404, 'NOT_FOUND', 'Project not found.');
  const notConnected = "Google Calendar isn't connected for this project. Connect it in the client hub → Calendar.";

  if (m[1] === 'calendarStatus') {
    if (!connected.has(input.projectId)) return ok(res, { connected: false, reason: notConnected, email: null, calendars: [] });
    return ok(res, {
      connected: true,
      reason: null,
      email: 'owner@example.com',
      calendars: [{ id: 'primary', name: 'Owner', primary: true, timeZone: 'America/New_York' }],
    });
  }
  if (!connected.has(input.projectId)) return err(res, 412, 'PRECONDITION_FAILED', notConnected);
  const p = input.params ?? {};
  switch (m[1]) {
    case 'findFreeSlots': {
      const start = new Date(Date.now() + 86_400_000).toISOString();
      const end = new Date(Date.now() + 86_400_000 + 30 * 60_000).toISOString();
      return ok(res, { timezone: 'America/New_York', durationMinutes: 30, slots: [{ start, end }], first: { start, end }, count: 1 });
    }
    case 'createEvent': {
      if (!p.start) return err(res, 400, 'BAD_REQUEST', 'Start "" is not a date/time');
      const id = `${input.projectId}:${input.idempotencyKey}`;
      const existing = events.get(id);
      if (existing) return ok(res, { ...existing, alreadyExisted: true });
      const event = {
        eventId: `evt${events.size + 1}`,
        link: `https://calendar.example/evt${events.size + 1}`,
        meetLink: p.addMeet === 'true' ? 'https://meet.example/abc' : null,
        start: p.start,
        end: p.start,
        timezone: 'America/New_York',
        guest: p.guestEmail ? { email: p.guestEmail, name: p.guestName || null } : null,
        alreadyExisted: false,
      };
      events.set(id, event);
      return ok(res, event);
    }
    case 'listEvents':
      return ok(res, { count: events.size, events: [...events.values()].map((e) => ({ id: e.eventId, title: 'x', start: e.start })) });
    case 'cancelEvent':
      return ok(res, { cancelled: true });
    default:
      return err(res, 404, 'NOT_FOUND', 'No such procedure');
  }
}).listen(PORT, () => console.log(`fake hub on http://localhost:${PORT}`));
