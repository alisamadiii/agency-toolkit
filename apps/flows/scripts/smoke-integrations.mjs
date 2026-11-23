// End-to-end check of Google Calendar steps through the client hub, against
// scripts/fake-hub.mjs. Flows must run with HUB_API_URL=http://localhost:3399 and the
// fake's key (see the README).
// Usage: FLOWS_ADMIN_KEY=... node scripts/smoke-integrations.mjs

const ROOT = (process.env.FLOWS_URL || 'http://localhost:3300').replace(/\/$/, '');
const BASE = ROOT + '/api/v1';
const FAKE = process.env.FAKE_HUB_URL || 'http://localhost:3399';
const FAKE_KEY = process.env.FAKE_HUB_KEY || 'test-key-test-key-test-key-test-key';
const ADMIN = process.env.FLOWS_ADMIN_KEY;
if (!ADMIN) throw new Error('Set FLOWS_ADMIN_KEY');

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
const app = (action, params, extra = {}) => ({
  provider: 'google_calendar',
  action,
  params,
  timeoutSec: 30,
  retries: 0,
  continueOnError: false,
  ...extra,
});
const runGraph = async (key, graph, input = {}) => {
  const wf = await api(key, 'POST', '/workflows', { name: `int ${Date.now()}`, graph });
  if (wf.status !== 201) throw new Error(JSON.stringify(wf.data));
  const r = await api(key, 'POST', `/workflows/${wf.data.id}/run`, { input });
  return waitRun(key, r.data.runId);
};
const step = (run, id) => run.steps.find((s) => s.stepId === id);
const fake = (path, body) =>
  fetch(FAKE + path, { method: body ? 'POST' : 'GET', body: body && JSON.stringify(body) }).then((r) => r.json());

const ws = [];
try {
  const a = await api(ADMIN, 'POST', '/workspaces', { name: 'int-a' });
  const b = await api(ADMIN, 'POST', '/workspaces', { name: 'int-b' });
  const c = await api(ADMIN, 'POST', '/workspaces', { name: 'int-c' });
  ws.push(a.data.id, b.data.id, c.data.id);
  const keyA = (await api(ADMIN, 'POST', `/workspaces/${a.data.id}/keys`, { name: 'a' })).data.key;
  const keyB = (await api(ADMIN, 'POST', `/workspaces/${b.data.id}/keys`, { name: 'b' })).data.key;
  const keyC = (await api(ADMIN, 'POST', `/workspaces/${c.data.id}/keys`, { name: 'c' })).data.key;
  // A: hub project with a calendar. B: hub project without one. C: not a hub project.
  await fake('/__setup', { connected: [a.data.id], known: [b.data.id] });

  // Status
  const sa = (await api(keyA, 'GET', '/integrations')).data.data[0];
  check(sa.connected && sa.accountEmail === 'owner@example.com' && sa.calendars?.length === 1, 'connected project shows the hub account');
  const sb = (await api(keyB, 'GET', '/integrations')).data.data[0];
  check(!sb.connected && /isn't connected/.test(sb.reason ?? ''), 'unconnected project explains why', sb.reason);
  const sc = (await api(keyC, 'GET', '/integrations')).data.data[0];
  check(!sc.connected && /not linked to a client hub project/.test(sc.reason ?? ''), 'non-hub workspace says so', sc.reason);

  // Find free time → book, in workspace A
  const graph = {
    nodes: [
      node('trigger', 'trigger', {}),
      node('find', 'app', app('find_free_slots', { durationMinutes: '30' })),
      node(
        'book',
        'app',
        app('create_event', { title: 'Call with {{input.name}}', start: '{{nodes.find.output.first.start}}', guestEmail: '{{input.email}}', addMeet: 'true' })
      ),
    ],
    edges: [edge('trigger', 'find'), edge('find', 'book')],
  };
  const run = await runGraph(keyA, graph, { name: 'Ana', email: 'ana@example.com' });
  const booked = step(run, 'book')?.output;
  check(run.status === 'success' && booked?.eventId && booked.meetLink && booked.guest?.email === 'ana@example.com', 'books through the hub', run.error ?? '');

  const calls = await fake('/__calls');
  const create = calls.find((x) => x.procedure === 'createEvent');
  check(calls.every((x) => x.authorization === `Bearer ${FAKE_KEY}`), 'every call carries the shared key');
  check(create?.input.projectId === a.data.id, 'project id is the workspace id');
  check(create?.input.idempotencyKey === `${run.id}:book`, 'idempotency key is run + node', create?.input.idempotencyKey);
  check(create?.input.params.title === 'Call with Ana' && create?.input.params.start === step(run, 'find').output.first.start, 'params are rendered templates');
  const status = calls.find((x) => x.procedure === 'calendarStatus');
  check(status?.method === 'GET', 'status is a tRPC query (GET)');

  // Same run + node again (a retry) → the hub returns the same event.
  const res = await fetch(`${FAKE}/api/trpc/flowsService.createEvent`, {
    method: 'POST',
    headers: { authorization: `Bearer ${FAKE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(create.input),
  }).then((r) => r.json());
  check(res.result?.data?.eventId === booked.eventId && res.result.data.alreadyExisted, 'a retry gets the same event back');

  // Errors from the hub reach the run.
  const runB = await runGraph(keyB, graph, { name: 'Bo', email: 'bo@example.com' });
  check(runB.status === 'failed' && /isn't connected/.test(step(runB, 'find')?.error ?? ''), "hub's error shows on the step", step(runB, 'find')?.error);

  // A workflow can't aim at another project: nothing in the JSON is used as the project.
  const sneaky = {
    nodes: [node('trigger', 'trigger', {}), node('x', 'app', app('list_events', { projectId: a.data.id }))],
    edges: [edge('trigger', 'x')],
  };
  const runC = await runGraph(keyC, sneaky);
  const last = (await fake('/__calls')).filter((x) => x.procedure === 'listEvents').pop();
  check(runC.status === 'failed' && last?.input.projectId === c.data.id, 'project comes from the workspace, not the workflow');

  // Nothing secret in what Flows returns.
  const dump = JSON.stringify([sa, run]);
  check(!dump.includes(FAKE_KEY) && !/access_?token|refresh_?token/i.test(dump), 'no key or tokens in API responses');
} finally {
  for (const id of ws) await api(ADMIN, 'DELETE', `/workspaces/${id}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll integration checks passed');
process.exit(failures ? 1 : 0);
