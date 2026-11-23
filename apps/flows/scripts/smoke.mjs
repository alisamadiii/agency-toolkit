// End-to-end check against a running instance.
// Usage: FLOWS_URL=http://localhost:3300 FLOWS_ADMIN_KEY=fl_admin_... node scripts/smoke.mjs
// Creates throwaway workspaces (smoke-*) and deletes them at the end.

const BASE = (process.env.FLOWS_URL || 'http://localhost:3300').replace(/\/$/, '') + '/api/v1';
const ADMIN = process.env.FLOWS_ADMIN_KEY;
if (!ADMIN) throw new Error('Set FLOWS_ADMIN_KEY');

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

async function api(key, method, path, body, workspaceId) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function waitRun(key, runId, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    const { data } = await api(key, 'GET', `/runs/${runId}`);
    if (!['queued', 'running'].includes(data.status)) return data;
    if (Date.now() - start > timeoutMs) return data;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function runWorkflow(key, steps, input = {}, extra = {}) {
  const wf = await api(key, 'POST', '/workflows', { name: `smoke ${Date.now()}`, ...(Array.isArray(steps) ? { steps } : { graph: steps }), ...extra });
  if (wf.status !== 201) throw new Error(`create workflow: ${JSON.stringify(wf.data)}`);
  const started = await api(key, 'POST', `/workflows/${wf.data.id}/run`, { input });
  return { wf: wf.data, run: await waitRun(key, started.data.runId) };
}

const created = [];
try {
  // --- Setup
  const me = await api(ADMIN, 'GET', '/me');
  check(me.status === 200 && me.data.admin, 'admin key works');
  check((await api('fl_live_nope', 'GET', '/me')).status === 401, 'bad key rejected');

  const a = await api(ADMIN, 'POST', '/workspaces', { name: 'smoke-a', allowedHosts: ['httpbin.org'] });
  const b = await api(ADMIN, 'POST', '/workspaces', { name: 'smoke-b' });
  const open = await api(ADMIN, 'POST', '/workspaces', { name: 'smoke-open', allowedHosts: ['*'] });
  created.push(a.data.id, b.data.id, open.data.id);
  check(a.status === 201 && b.status === 201, 'workspaces created');
  check(
    (await api(ADMIN, 'POST', '/workspaces', { name: 'bad', allowedHosts: ['localhost'] })).status === 400,
    'internal allowed host rejected'
  );

  const keyA = (await api(ADMIN, 'POST', `/workspaces/${a.data.id}/keys`, { name: 'a' })).data.key;
  const keyB = (await api(ADMIN, 'POST', `/workspaces/${b.data.id}/keys`, { name: 'b' })).data.key;
  const keyOpen = (await api(ADMIN, 'POST', `/workspaces/${open.data.id}/keys`, { name: 'open' })).data.key;
  check(keyA?.startsWith('fl_live_'), 'workspace keys issued');
  check((await api(keyA, 'GET', '/workspaces')).status === 403, 'workspace key cannot list workspaces');

  // --- Happy path: http -> script, templating, secrets masked
  await api(keyA, 'PUT', '/secrets/TOKEN', { value: 'super-secret-value' });
  const happy = await runWorkflow(
    keyA,
    [
      {
        id: 'fetch',
        type: 'http',
        url: 'https://httpbin.org/anything?client={{input.client}}',
        method: 'POST',
        headers: { 'x-token': '{{secrets.TOKEN}}' },
        body: { hello: '{{input.client}}' },
      },
      {
        id: 'shape',
        type: 'script',
        code: 'export default async ({ input, steps, secrets }) => { console.log("got", steps.fetch.output.status); return { status: steps.fetch.output.status, echoed: steps.fetch.output.body.json.hello, hasSecret: secrets.TOKEN.length > 0 }; }',
      },
    ],
    { client: 'acme' }
  );
  check(happy.run.status === 'success', 'http + script run succeeds', happy.run.error ?? '');
  check(happy.run.output?.status === 200 && happy.run.output?.echoed === 'acme', 'step outputs and templating flow through');
  check(happy.run.output?.hasSecret === true, 'script receives secrets');
  check(!JSON.stringify(happy.run).includes('super-secret-value'), 'secret value masked in stored run');
  check(happy.run.steps.find((s) => s.stepId === 'shape')?.logs?.includes('got 200'), 'script logs captured');

  // --- Isolation
  check((await api(keyB, 'GET', `/workflows/${happy.wf.id}`)).status === 404, "workspace B can't read A's workflow");
  check((await api(keyB, 'GET', `/runs/${happy.run.id}`)).status === 404, "workspace B can't read A's run");
  check((await api(ADMIN, 'GET', `/workflows/${happy.wf.id}`, undefined, a.data.id)).status === 200, 'admin reads via x-workspace-id');

  // --- Network guard
  const notAllowed = await runWorkflow(keyA, [{ id: 'x', type: 'http', url: 'https://example.com/' }]);
  check(notAllowed.run.status === 'failed' && /allowed hosts/.test(notAllowed.run.error), 'host outside allow-list blocked');
  for (const url of ['http://127.0.0.1:3300/api/health', 'http://169.254.169.254/latest/meta-data', 'http://localtest.me:3300/api/health']) {
    const r = await runWorkflow(keyOpen, [{ id: 'x', type: 'http', url }]);
    check(r.run.status === 'failed' && /private|Blocked/i.test(r.run.error), `private address blocked: ${url}`, r.run.error ?? '');
  }

  // --- Script sandbox
  const sandbox = async (label, code, match) => {
    const r = await runWorkflow(keyOpen, [{ id: 's', type: 'script', code, timeoutSec: 3 }]);
    check(r.run.status === 'failed' && match.test(r.run.error ?? ''), label, (r.run.error ?? r.run.status).slice(0, 100));
  };
  await sandbox('script cannot read files', 'export default () => Deno.readTextFileSync("/etc/passwd")', /read access/);
  await sandbox('script cannot read env', 'export default () => Deno.env.get("DATABASE_URL")', /env access/);
  await sandbox('script cannot spawn processes', 'export default () => new Deno.Command("ls").outputSync()', /run access/);
  await sandbox('script cannot reach private network', 'export default async () => (await fetch("http://localtest.me:3300/api/health")).status', /net access|fetch failed|NotCapable/i);
  await sandbox('infinite loop times out', 'export default () => { while (true) {} }', /timed out/);

  // --- Graph: IF branching, skipped branch, parallel fan-out and join, continueOnError
  const node = (id, type, config, extra = {}) => ({ id, type, name: id, position: { x: 0, y: 0 }, config, ...extra });
  const code = (src) => ({ code: src });
  const edge = (source, target, sourceHandle = null) => ({ id: `${source}-${sourceHandle ?? 'o'}-${target}`, source, target, sourceHandle });

  const branching = await runWorkflow(keyA, {
    nodes: [
      node('trigger', 'trigger', {}),
      node('fetch', 'http', { url: 'https://httpbin.org/status/{{input.code}}', continueOnError: true }),
      node('check', 'if', { conditions: [{ left: '{{nodes.fetch.output.status}}', op: 'equals', right: '200' }] }),
      node('yes', 'code', code('export default () => "yes"')),
      node('no', 'code', code('export default () => "no"')),
      node('after_no', 'code', code('export default () => "after"')),
    ],
    edges: [edge('trigger', 'fetch'), edge('fetch', 'check'), edge('check', 'yes', 'true'), edge('check', 'no', 'false'), edge('no', 'after_no')],
  }, { code: 200 });
  const st = Object.fromEntries(branching.run.steps.map((s) => [s.stepId, s.status]));
  check(branching.run.status === 'success' && st.yes === 'success' && st.no === 'skipped' && st.after_no === 'skipped',
    'IF true branch runs, false branch and its children skipped', JSON.stringify(st));

  const falsePath = await api(keyA, 'POST', `/workflows/${branching.wf.id}/run`, { input: { code: 500 } });
  const fp = await waitRun(keyA, falsePath.data.runId);
  const fst = Object.fromEntries(fp.steps.map((s) => [s.stepId, s.status]));
  check(fp.status === 'success' && fst.fetch === 'failed' && fst.no === 'success' && fst.yes === 'skipped' && fp.output === 'after',
    'continueOnError + false branch', JSON.stringify(fst));

  const parallel = await runWorkflow(keyA, {
    nodes: [
      node('trigger', 'trigger', {}),
      node('a', 'code', code('export default async () => { await new Promise(r => setTimeout(r, 800)); return 1 }')),
      node('b', 'code', code('export default async () => { await new Promise(r => setTimeout(r, 800)); return 2 }')),
      node('sum', 'code', code('export default ({ nodes }) => nodes.a.output + nodes.b.output')),
    ],
    edges: [edge('trigger', 'a'), edge('trigger', 'b'), edge('a', 'sum'), edge('b', 'sum')],
  });
  const dur = new Date(parallel.run.finishedAt) - new Date(parallel.run.startedAt);
  check(parallel.run.status === 'success' && parallel.run.output === 3, 'parallel branches join', `output ${parallel.run.output}`);
  check(dur < 2600, 'branches ran in parallel', `${dur} ms`);

  const invalid = async (label, graph) =>
    check((await api(keyA, 'POST', '/workflows', { name: 'bad', graph })).status === 400, label);
  await invalid('cycle rejected', { nodes: [node('trigger', 'trigger', {}), node('a', 'code', code('export default () => 1')), node('b', 'code', code('export default () => 1'))], edges: [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'a')] });
  await invalid('two triggers rejected', { nodes: [node('t1', 'trigger', {}), node('t2', 'trigger', {})], edges: [] });
  await invalid('IF edge without handle rejected', { nodes: [node('trigger', 'trigger', {}), node('i', 'if', { conditions: [{ left: '1', op: 'equals', right: '1' }] }), node('a', 'code', code('export default () => 1'))], edges: [edge('trigger', 'i'), edge('i', 'a')] });

  // --- Notification channels (per workspace), Notify node, run alerts
  const types = await api(keyA, 'GET', '/channel-types');
  check(types.status === 200 && types.data.data.length >= 10, 'channel types listed', `${types.data.data?.length} types`);
  const ch = await api(keyA, 'POST', '/channels', {
    name: 'Hub webhook',
    type: 'webhook',
    config: { url: 'https://httpbin.org/post', secret: 'whsec_super_secret' },
  });
  check(ch.status === 201 && ch.data.config.secret === '••••••••', 'channel created, secret masked');
  const tested = await api(keyA, 'POST', `/channels/${ch.data.id}/test`, {});
  check(tested.data?.ok === true, 'channel test sends', tested.data?.error ?? '');
  const patched = await api(keyA, 'PATCH', `/channels/${ch.data.id}`, { name: 'Hub hook', config: { url: 'https://httpbin.org/post', secret: '••••••••' } });
  check(patched.data?.name === 'Hub hook', 'channel renamed, masked secret kept');
  check((await api(keyA, 'POST', '/channels', { name: 'bad', type: 'slack', config: { webhookUrl: 'nope' } })).status === 400, 'invalid channel config rejected');

  const internal = await api(keyOpen, 'POST', '/channels', { name: 'internal', type: 'webhook', config: { url: 'http://127.0.0.1:3300/api/health' } });
  const badTest = await api(keyOpen, 'POST', `/channels/${internal.data.id}/test`, {});
  check(badTest.data?.ok === false && /private|Blocked/i.test(badTest.data.error), 'channel to private address blocked', badTest.data?.error);

  // Isolation: B can't see, use, test or delete A's channel.
  check((await api(keyB, 'GET', `/channels/${ch.data.id}`)).status === 404, "workspace B can't read A's channel");
  check((await api(keyB, 'POST', `/channels/${ch.data.id}/test`, {})).status === 404, "workspace B can't test A's channel");
  check((await api(keyB, 'DELETE', `/channels/${ch.data.id}`)).status === 404, "workspace B can't delete A's channel");
  check((await api(keyB, 'GET', '/channels')).data.data.length === 0, "workspace B's list has only its own channels");
  const stolen = await api(keyB, 'POST', '/workflows', {
    name: 'steal',
    graph: { nodes: [node('trigger', 'trigger', {}), node('n', 'notify', { channelId: ch.data.id, message: 'hi' })], edges: [edge('trigger', 'n')] },
  });
  check(stolen.status === 400, "workspace B can't use A's channel in a Notify node");

  const notify = await runWorkflow(keyA, {
    nodes: [
      node('trigger', 'trigger', {}),
      node('tell', 'notify', { channelId: ch.data.id, title: 'New signup', message: 'Welcome {{input.user.name}}', to: '{{input.user.email}}' }),
    ],
    edges: [edge('trigger', 'tell')],
  }, { user: { name: 'Sam', email: 'sam@example.com' } }, { alertOn: 'always', alertChannelIds: [ch.data.id] });
  check(notify.run.status === 'success' && notify.run.output?.message === 'Welcome Sam' && notify.run.output?.to === 'sam@example.com',
    'Notify node renders templates and sends', JSON.stringify(notify.run.output));
  const wfAfter = await api(keyA, 'PATCH', `/workflows/${notify.wf.id}`, { name: 'renamed' });
  check(wfAfter.data.alertOn === 'always' && wfAfter.data.alertChannelIds.length === 1, 'PATCH keeps fields it was not sent');

  // --- Validation & schedules
  const bad = await api(keyA, 'POST', '/workflows', { name: 'x', steps: [{ id: 'a', type: 'http' }] });
  check(bad.status === 400, 'invalid workflow rejected');
  const preview = await api(keyA, 'POST', '/validate', { cron: '0 9 * * 1-5', timezone: 'America/New_York' });
  check(preview.data.cron?.next?.length === 5, 'cron preview works');
  check((await api(keyA, 'POST', `/workflows/${happy.wf.id}/schedules`, { cron: '* * * * * *' })).status === 400, 'sub-minute cron rejected');
  const sched = await api(keyA, 'POST', `/workflows/${happy.wf.id}/schedules`, { cron: '* * * * *', input: { client: 'cron' } });
  check(sched.status === 201 && sched.data.nextRunAt, 'schedule created', sched.data.nextRunAt);

  if (process.env.SMOKE_WAIT_SCHEDULE) {
    console.log('… waiting ~80s for the schedule to fire');
    await new Promise((r) => setTimeout(r, 80_000));
    const runs = await api(keyA, 'GET', `/runs?workflowId=${happy.wf.id}`);
    const fromSchedule = runs.data.data.filter((r) => r.trigger === 'schedule');
    check(fromSchedule.length >= 1, 'schedule fired', `${fromSchedule.length} run(s)`);
  }

  // --- Public trigger + cancel
  const hook = await fetch(happy.wf.triggerUrl, { method: 'POST', body: JSON.stringify({ client: 'hook' }) });
  const hookRun = await waitRun(keyA, (await hook.json()).runId);
  check(hook.status === 202 && hookRun.trigger === 'webhook' && hookRun.status === 'success', 'trigger URL starts a run');
  check((await fetch(happy.wf.triggerUrl + 'x', { method: 'POST' })).status === 404, 'wrong trigger token rejected');

  const slow = await api(keyOpen, 'POST', '/workflows', {
    name: 'slow',
    steps: [{ id: 's', type: 'script', code: 'export default () => new Promise((r) => setTimeout(r, 20000))', timeoutSec: 60 }],
  });
  const slowRun = (await api(keyOpen, 'POST', `/workflows/${slow.data.id}/run`, {})).data.runId;
  await new Promise((r) => setTimeout(r, 1500));
  await api(keyOpen, 'POST', `/runs/${slowRun}/cancel`);
  const cancelled = await waitRun(keyOpen, slowRun, 30_000);
  check(cancelled.status === 'cancelled', 'running run can be cancelled', cancelled.status);

  check((await (await fetch(BASE + '/openapi.json')).json()).openapi === '3.1.0', 'OpenAPI spec served');

  // --- Client hub embed (/iframe)
  const ROOT = BASE.replace(/\/api\/v1$/, '');
  const hubProject = crypto.randomUUID();
  const embed = (role) => api(ADMIN, 'POST', '/embed-sessions', { projectId: hubProject, projectName: 'smoke-embed', role });
  check((await api(keyA, 'POST', '/embed-sessions', { projectId: 'x', projectName: 'x', role: 'full-access' })).status === 403,
    'embed sessions need the admin key');
  const e1 = await embed('full-access');
  const e2 = await embed('view-only');
  created.push(e1.data.workspaceId);
  check(e1.status === 201 && e1.data.workspaceId === e2.data.workspaceId, 'one workspace per hub project');
  check(e1.data.workspaceId === hubProject, 'workspace id equals the hub project id', e1.data.workspaceId);
  check((await api(ADMIN, 'POST', '/embed-sessions', { projectId: 'not-a-uuid', projectName: 'x', role: 'view-only' })).status === 400,
    'hub project id must be a uuid');
  const linkedId = crypto.randomUUID();
  const linked = await api(ADMIN, 'POST', '/workspaces', { id: linkedId, name: 'smoke-linked' });
  created.push(linked.data?.id);
  check(linked.status === 201 && linked.data.id === linkedId && linked.data.externalId === linkedId, 'admin can create a workspace with a given (hub) id');
  check((await api(ADMIN, 'POST', '/workspaces', { id: linkedId, name: 'dup' })).status === 409, 'duplicate workspace id rejected');
  const start = await fetch(e1.data.url, { redirect: 'manual' });
  const setCookie = start.headers.get('set-cookie') ?? '';
  check(start.status === 303 && /flows_embed=.*HttpOnly.*Secure.*SameSite=None.*Partitioned/i.test(setCookie), 'ticket gives a locked-down cookie');
  check((await fetch(e1.data.url, { redirect: 'manual' })).status === 401, 'ticket is single use');
  const e3 = await embed('full-access');
  check((await fetch(e3.data.url, { redirect: 'manual', headers: { referer: 'https://evil.example.com/' } })).status === 401,
    'ticket refused from another site');
  const cookieVal = setCookie.match(/flows_embed=([^;]+)/)[1];
  const page = await fetch(ROOT + '/iframe', { redirect: 'manual', headers: { cookie: `flows_embed=${cookieVal}` } });
  check(page.status === 200, 'embed session opens /iframe');
  const [b64, mac] = cookieVal.split('.');
  const forged = JSON.parse(Buffer.from(b64, 'base64url'));
  forged.workspaceId = a.data.id;
  const forgedVal = Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + mac;
  const forgedPage = await fetch(ROOT + '/iframe', { redirect: 'manual', headers: { cookie: `flows_embed=${forgedVal}` } });
  check(forgedPage.status === 307 && /expired/.test(forgedPage.headers.get('location') ?? ''), 'tampered cookie rejected');
  const iframeCsp = page.headers.get('content-security-policy') ?? '';
  check(/frame-ancestors [^;]*https:\/\/app\.alisamadii\.com/.test(iframeCsp) && !/'none'/.test(iframeCsp), '/iframe framable only by the hub', iframeCsp);
  const signIn = await fetch(ROOT + '/sign-in', { redirect: 'manual' });
  check(/frame-ancestors 'none'/.test(signIn.headers.get('content-security-policy') ?? '') && signIn.headers.get('x-frame-options') === 'DENY',
    'dashboard cannot be framed');
} finally {
  for (const id of created) await api(ADMIN, 'DELETE', `/workspaces/${id}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
