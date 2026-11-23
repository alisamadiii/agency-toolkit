// End-to-end check of Google Calendar integrations against scripts/fake-google.mjs.
// Flows must run with the fake Google env (see the README); needs DATABASE_URL too.
// Usage: FLOWS_ADMIN_KEY=... node --env-file=.env.local scripts/smoke-integrations.mjs
import postgres from 'postgres';

const ROOT = (process.env.FLOWS_URL || 'http://localhost:3300').replace(/\/$/, '');
const BASE = ROOT + '/api/v1';
const FAKE = process.env.FAKE_GOOGLE_URL || 'http://localhost:3399';
const ADMIN = process.env.FLOWS_ADMIN_KEY;
const sql = postgres(process.env.DATABASE_URL);
let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
async function api(key, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text };
}
const waitRun = async (key, id) => {
  for (let i = 0; i < 120; i++) {
    const { data } = await api(key, 'GET', `/runs/${id}`);
    if (!['queued', 'running'].includes(data.status)) return data;
    await new Promise((r) => setTimeout(r, 500));
  }
};
const node = (id, type, config) => ({ id, type, name: id, position: { x: 0, y: 0 }, config });
const edge = (s, t) => ({ id: `${s}-${t}`, source: s, target: t });
const runGraph = async (key, graph, input = {}) => {
  const wf = await api(key, 'POST', '/workflows', { name: `int ${Date.now()}`, graph });
  if (wf.status !== 201) throw new Error(JSON.stringify(wf.data));
  const r = await api(key, 'POST', `/workflows/${wf.data.id}/run`, { input });
  return waitRun(key, r.data.runId);
};

const ws = [];
try {
  const a = await api(ADMIN, 'POST', '/workspaces', { name: 'int-a' });
  const b = await api(ADMIN, 'POST', '/workspaces', { name: 'int-b' });
  ws.push(a.data.id, b.data.id);
  const keyA = (await api(ADMIN, 'POST', `/workspaces/${a.data.id}/keys`, { name: 'a' })).data.key;
  const keyB = (await api(ADMIN, 'POST', `/workspaces/${b.data.id}/keys`, { name: 'b' })).data.key;

  // Connect
  const start = await api(keyA, 'POST', '/integrations/google_calendar/connect');
  const authUrl = new URL(start.data.url);
  const st = authUrl.searchParams.get('state');
  check(start.status === 200 && st && authUrl.searchParams.get('code_challenge_method') === 'S256' && authUrl.searchParams.get('access_type') === 'offline',
    'connect gives a PKCE + offline sign-in URL');
  const cb = await fetch(`${ROOT}/api/integrations/google/callback?state=${st}&code=good-code`);
  check(cb.status === 200 && (await cb.text()).includes('connected'), 'callback connects the account');
  const again = await fetch(`${ROOT}/api/integrations/google/callback?state=${st}&code=good-code`);
  check(again.status === 400, 'sign-in state is single use');
  const status = await api(keyA, 'GET', '/integrations');
  const gc = status.data.data.find((i) => i.provider === 'google_calendar');
  check(gc.connected && gc.accountEmail === 'owner@fake.test', 'status shows the connected account');
  check(!/fake-(access|refresh)/.test(status.text), 'tokens never in API responses');
  const [row] = await sql`select access_token, refresh_token from integration where workspace_id = ${a.data.id}`;
  check(row && !row.access_token.includes('fake-access') && !row.refresh_token.includes('fake-refresh'), 'tokens stored encrypted');
  check((await api(keyB, 'GET', '/integrations')).data.data[0].connected === false, "workspace B doesn't see A's connection");

  // Find a slot, book it
  const booked = await runGraph(keyA, {
    nodes: [
      node('trigger', 'trigger', {}),
      node('find_free_slots_1', 'app', { provider: 'google_calendar', action: 'find_free_slots', params: { durationMinutes: '30', from: 'now', to: '+7 days' } }),
      node('create_event_1', 'app', { provider: 'google_calendar', action: 'create_event', params: {
        title: 'Call with {{input.name}}', start: '{{nodes.find_free_slots_1.output.first.start}}', durationMinutes: '30',
        guestEmail: '{{input.email}}', guestName: '{{input.name}}', addMeet: 'true' } }),
    ],
    edges: [edge('trigger', 'find_free_slots_1'), edge('find_free_slots_1', 'create_event_1')],
  }, { name: 'Jane', email: 'jane@example.com' });
  const slots = booked.steps.find((s) => s.stepId === 'find_free_slots_1')?.output;
  const ev = booked.output;
  check(booked.status === 'success' && slots?.timezone === 'America/New_York' && slots?.count > 0, 'find free time returns slots', `${slots?.count} slots`);
  const busyHit = (slots?.slots ?? []).some((s) => {
    const st2 = new Date(s.start).getTime();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    return st2 < new Date(`${tomorrow}T11:00:00-05:00`).getTime() && new Date(s.end).getTime() > new Date(`${tomorrow}T10:00:00-05:00`).getTime();
  });
  check(!busyHit, 'free slots skip busy events');
  check(ev?.eventId && ev.guest?.email === 'jane@example.com' && ev.meetLink, 'meeting booked with guest + Meet link');

  // Retry safety: first response lost, retry must not double book.
  const before = (await (await fetch(`${FAKE}/__state`)).json()).events.length;
  const flaky = await runGraph(keyA, {
    nodes: [
      node('trigger', 'trigger', {}),
      node('book', 'app', { provider: 'google_calendar', action: 'create_event', retries: 2, params: { title: 'flaky {{input.n}}', start: '2030-01-07T15:00:00Z' } }),
    ],
    edges: [edge('trigger', 'book')],
  }, { n: 1 });
  const after = (await (await fetch(`${FAKE}/__state`)).json()).events.length;
  check(flaky.status === 'success' && flaky.output.alreadyExisted === true && after - before === 1, 'retry after a lost response books once', `${after - before} event(s)`);

  // Isolation: B has no connection.
  const bRun = await runGraph(keyB, {
    nodes: [node('trigger', 'trigger', {}), node('l', 'app', { provider: 'google_calendar', action: 'list_events', params: {} })],
    edges: [edge('trigger', 'l')],
  });
  check(bRun.status === 'failed' && /isn't connected/.test(bRun.error), "workspace B can't use A's calendar");

  // Refresh: expired token gets refreshed.
  await sql`update integration set expires_at = now() - interval '1 hour' where workspace_id = ${a.data.id}`;
  const refreshed = await runGraph(keyA, {
    nodes: [node('trigger', 'trigger', {}), node('l', 'app', { provider: 'google_calendar', action: 'list_events', params: {} })],
    edges: [edge('trigger', 'l')],
  });
  const fstate = await (await fetch(`${FAKE}/__state`)).json();
  check(refreshed.status === 'success' && fstate.refreshes >= 1, 'expired token is refreshed');

  // Failed refresh → needs reconnect.
  await fetch(`${FAKE}/__fail-refresh`);
  await sql`update integration set expires_at = now() - interval '1 hour' where workspace_id = ${a.data.id}`;
  const broken = await runGraph(keyA, {
    nodes: [node('trigger', 'trigger', {}), node('l', 'app', { provider: 'google_calendar', action: 'list_events', params: {} })],
    edges: [edge('trigger', 'l')],
  });
  const st3 = (await api(keyA, 'GET', '/integrations')).data.data[0];
  check(broken.status === 'failed' && /reconnect/i.test(broken.error) && st3.status === 'needs_reconnect', 'failed refresh asks to reconnect');

  // No tokens in run data.
  const allRuns = await sql`select output, error from run where workspace_id = ${a.data.id}`;
  const steps = await sql`select s.output, s.logs, s.error from run_step s join run r on r.id = s.run_id where r.workspace_id = ${a.data.id}`;
  check(!/fake-(access|refresh)/.test(JSON.stringify([allRuns, steps])), 'tokens never in run output or logs');

  // Disconnect revokes.
  const disc = await api(keyA, 'DELETE', '/integrations/google_calendar');
  const fs2 = await (await fetch(`${FAKE}/__state`)).json();
  check(disc.status === 200 && fs2.revoked.includes('fake-refresh-1'), 'disconnect revokes at Google');
} finally {
  for (const id of ws) await api(ADMIN, 'DELETE', `/workspaces/${id}`);
  await sql.end();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
