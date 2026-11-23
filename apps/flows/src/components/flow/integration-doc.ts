import { topoOrder, type Graph, type GraphNode } from '@/lib/schemas';

// Turns a workflow graph into human/AI-readable integration docs: what it does,
// which input fields it reads, and copy-paste instructions for calling it.

export type InputField = { path: string; usedIn: string[]; kind: string; example: unknown };

function guess(path: string): { kind: string; example: unknown } {
  const leaf = path.split('.').pop()!.toLowerCase();
  if (leaf.includes('email')) return { kind: 'email', example: 'user@example.com' };
  if (leaf.includes('phone')) return { kind: 'phone', example: '+15555550123' };
  if (/(at|date|time|day)$/.test(leaf) || leaf.includes('date')) return { kind: 'ISO date', example: '2026-12-01T10:00:00Z' };
  if (/(count|amount|price|total|qty|quantity|number|age|duration)/.test(leaf)) return { kind: 'number', example: 1 };
  if (/^(is|has)[A-Z_]/.test(path.split('.').pop()!) || /(enabled|active|paid|confirmed)$/.test(leaf)) {
    return { kind: 'boolean', example: true };
  }
  if (leaf === 'id' || leaf.endsWith('id')) return { kind: 'string (id)', example: 'abc_123' };
  if (leaf.includes('name')) return { kind: 'string', example: 'Example Name' };
  if (leaf.includes('url')) return { kind: 'URL', example: 'https://example.com' };
  return { kind: 'string', example: `<${path.split('.').pop()}>` };
}

const TEMPLATE_INPUT = /\{\{\s*input\.([a-zA-Z0-9_.[\]]+)/g;
// Code nodes read input.x directly (destructured from the first argument).
const CODE_INPUT = /\binput\.([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)/g;

export function inputFields(graph: Graph): InputField[] {
  const fields = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const text = JSON.stringify(node.config);
    const add = (raw: string) => {
      const path = raw.replace(/\[\d+\]/g, '').replace(/\.$/, '');
      if (!path) return;
      if (!fields.has(path)) fields.set(path, new Set());
      fields.get(path)!.add(node.name);
    };
    for (const m of text.matchAll(TEMPLATE_INPUT)) add(m[1]);
    if (node.type === 'code') for (const m of node.config.code.matchAll(CODE_INPUT)) add(m[1]);
  }
  // Drop parents when a deeper path exists (user + user.email → user.email).
  const paths = [...fields.keys()];
  return paths
    .filter((p) => !paths.some((q) => q !== p && q.startsWith(p + '.')))
    .sort()
    .map((path) => ({ path, usedIn: [...fields.get(path)!], ...guess(path) }));
}

export function sampleInput(graph: Graph): Record<string, unknown> {
  const fields = inputFields(graph);
  const root: Record<string, unknown> = {};
  for (const f of fields) {
    const parts = f.path.split('.');
    let cur = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) cur[part] = f.example;
      else {
        if (typeof cur[part] !== 'object' || cur[part] === null) cur[part] = {};
        cur = cur[part] as Record<string, unknown>;
      }
    });
  }
  return root;
}

const OPS: Record<string, string> = {
  equals: '=',
  notEquals: '≠',
  contains: 'contains',
  gt: '>',
  lt: '<',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  isTrue: 'is true',
};

function describe(node: GraphNode, graph: Graph, names: Map<string, string>): string {
  const after = (handle?: 'true' | 'false') =>
    graph.edges
      .filter((e) => e.source === node.id && (handle ? e.sourceHandle === handle : true))
      .map((e) => names.get(e.target))
      .join(', ') || 'nothing';
  switch (node.type) {
    case 'trigger':
      return `Starts the run (trigger URL, API call, schedule or manual run). The JSON body becomes \`input\`.`;
    case 'http': {
      const c = node.config;
      const body = c.body !== undefined && c.method !== 'GET' ? ` with body ${JSON.stringify(c.body)}` : '';
      return `HTTP ${c.method} ${c.url}${body}.${c.continueOnError ? ' Failures are tolerated.' : ''}`;
    }
    case 'code': {
      const firstComment = node.config.code.match(/\/\/\s*(.+)/)?.[1];
      return `Runs sandboxed code${firstComment ? ` (${firstComment.trim()})` : ''}.`;
    }
    case 'if': {
      const conds = node.config.conditions
        .map((c) => `${c.left} ${OPS[c.op]}${['isEmpty', 'isNotEmpty', 'isTrue'].includes(c.op) ? '' : ` ${c.right}`}`)
        .join(` ${node.config.combine.toUpperCase()} `);
      return `Checks ${conds}. True → ${after('true')}; false → ${after('false')}.`;
    }
    case 'notify': {
      const c = node.config;
      const to = c.to ? ` to ${c.to}` : '';
      return `Sends a notification through one of the workspace's channels${to}: "${c.title || 'Notification'}" — ${c.message}`;
    }
  }
}

export function steps(graph: Graph): { name: string; type: string; text: string }[] {
  const order = topoOrder(
    graph.nodes.map((n) => n.id),
    graph.edges
  ) ?? graph.nodes.map((n) => n.id);
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return order.map((id) => {
    const n = byId.get(id)!;
    return { name: n.name, type: n.type, text: describe(n, graph, names) };
  });
}

export type Mode = 'overview' | 'url' | 'api' | 'result';

export type PromptContext = {
  workflowName: string;
  description: string;
  workflowId: string;
  workspaceId: string;
  origin: string;
  triggerUrl: string;
  envName: string;
  graph: Graph;
  onFinishUrl: string;
};

// Everything an AI coding assistant needs to wire this workflow into a project.
export function aiPrompt(mode: Mode, ctx: PromptContext): string {
  const fields = inputFields(ctx.graph);
  const body = JSON.stringify(sampleInput(ctx.graph), null, 2);
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(
    `I want my app to trigger a workflow that runs on my self-hosted Flows server (a cron/workflow service with a REST API). Implement the integration in this codebase.`,
    '',
    `## The workflow`,
    `- Name: ${ctx.workflowName}`,
    `- Purpose: ${ctx.description || '(not written yet; infer from the steps and ask me if unclear)'}`,
    `- Steps, in order:`,
    ...steps(ctx.graph).map((s, i) => `  ${i + 1}. ${s.name} (${s.type}): ${s.text}`)
  );
  const codeNodes = ctx.graph.nodes.filter((n) => n.type === 'code');
  for (const n of codeNodes) {
    if (n.type !== 'code') continue;
    const code = n.config.code.length > 1500 ? n.config.code.slice(0, 1500) + '\n// …(truncated)' : n.config.code;
    push('', `Code of "${n.name}" (runs on Flows, shown so you know what the input is used for):`, '```js', code.trim(), '```');
  }
  push('', `## Input it expects (JSON body)`);
  if (fields.length) {
    push(
      `The workflow reads these fields. Send all of them; map each one from my app's data (look at my models/forms; ask me if a field has no obvious source):`,
      ...fields.map((f) => `- \`${f.path}\` (${f.kind}), used by: ${f.usedIn.join(', ')}`)
    );
    push('', 'Example body:', '```json', body, '```', '');
  } else {
    push(`None. No node reads \`input\`, so send an empty JSON object \`{}\`.`, '');
  }

  if (mode === 'api') {
    push(
      `## How to call it (API with key)`,
      `- \`POST ${ctx.origin}/api/v1/workflows/${ctx.workflowId}/run\``,
      `- Headers: \`authorization: Bearer <FLOWS_API_KEY>\`, \`content-type: application/json\``,
      `- Body: \`{ "input": <the JSON above> }\``,
      `- Env vars: \`FLOWS_URL=${ctx.origin}\`, \`FLOWS_API_KEY\` (a workspace key, starts with fl_live_). If the key is an admin key (fl_admin_), also send header \`x-workspace-id: ${ctx.workspaceId}\`.`,
      `- Response: \`202 { "runId": "...", "status": "queued" }\`. 401 bad key, 404 wrong workflow, 409 workflow inactive, 400 invalid body (details in \`error\`/\`details\`).`
    );
  } else {
    push(
      `## How to call it (trigger URL, no API key)`,
      `- \`POST ${ctx.triggerUrl}\``,
      `- Header \`content-type: application/json\`; the body is the JSON above (not wrapped).`,
      `- Store the URL in an env var \`${ctx.envName}\` (it contains a secret token). Add it to .env.example without the real value.`,
      `- Response: \`202 { "runId": "..." }\`. 404 means the URL is wrong or was rotated, 409 means the workflow is inactive.`
    );
  }
  push(
    '',
    `## Requirements`,
    `- Call it from server-side code only (API route, server action, background job, webhook handler), never from browser code.`,
    `- Trigger it at the moment "${ctx.workflowName}" should run, after the related data is saved (ask me which event in my app that is if it isn't obvious).`,
    `- Use a 5 second timeout and catch every error: a failed or slow trigger must never break or slow down the user's action. Log failures.`,
    `- Put the call in one small helper (e.g. \`triggerFlow()\` in lib/) and call it from where the event happens.`,
    `- The workflow runs in the background; don't wait for it to finish in the request.`
  );

  if (mode === 'result' || mode === 'overview') {
    push(
      '',
      `## Getting the result (if my app needs it)`,
      `- Poll: \`GET ${ctx.origin}/api/v1/runs/<runId>\` with \`authorization: Bearer <FLOWS_API_KEY>\`. Fields: \`status\` (queued | running | success | failed | cancelled | timeout), \`output\`, \`error\`, \`steps[]\` (per-node status/output/logs).`,
      ctx.onFinishUrl
        ? `- Callback: Flows POSTs each finished run to \`${ctx.onFinishUrl}\`.`
        : `- Callback (optional): set a Callback URL on the workflow and Flows POSTs each finished run there.`,
      `- Callback body: \`{ "event": "run.finished", "run": { id, workflowId, status, output, error, startedAt, finishedAt } }\`.`,
      `- Verify the callback: header \`x-flows-signature: sha256=<hex>\` = HMAC-SHA256 of the raw request body with \`FLOWS_SIGNING_SECRET\` (workspace signing secret). Compare with a timing-safe equal and reject with 401 if it doesn't match. Read the raw body before parsing JSON.`
    );
  }
  push('', `When done, tell me which file triggers it, which env vars to set, and how each input field is filled.`);
  return lines.join('\n');
}
