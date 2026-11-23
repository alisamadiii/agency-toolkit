import { findAction } from '@/lib/integrations/registry';
import type { GraphNode, NodeType } from '@/lib/schemas';

// Everything a node can reference with {{…}} (or read in a Code node): the trigger's
// fields, outputs of nodes that run before it, run info and secrets. One list feeds the
// {{ menu, the Code editor's completions and the Variables chips.

export type Variable = {
  // Stable id of the source (trigger, node id, run, secrets); groups the list.
  source: string;
  // Heading shown above the source's rows.
  group: string;
  // Without braces, e.g. input.customer.email
  path: string;
  label: string;
  type?: string;
  preview?: string;
  // Shown as a chip under the form (top-level fields and known outputs).
  featured?: boolean;
};

export type UpstreamNode = { id: string; type: NodeType; name: string; config: GraphNode['config'] };

type OutputHint = { path: string; label: string };

// What each node type returns before it has ever run. Keyed by NodeType, so a new node
// type does not compile until it says what it outputs.
const NODE_OUTPUTS: Record<NodeType, (config: GraphNode['config']) => OutputHint[]> = {
  trigger: () => [],
  http: () => [
    { path: 'status', label: 'status code' },
    { path: 'body', label: 'body' },
    { path: 'headers', label: 'headers' },
  ],
  code: (config) => returnedKeys((config as { code?: string }).code ?? '').map((k) => ({ path: k, label: k })),
  if: () => [{ path: 'result', label: 'result (true/false)' }],
  notify: () => [
    { path: 'ok', label: 'sent' },
    { path: 'to', label: 'sent to' },
  ],
  app: (config) => {
    const c = config as { provider?: string; action?: string };
    return findAction(c.provider ?? '', c.action ?? '')?.outputHints ?? [];
  },
};

// Steps set to "continue on error" output { error } when they fail.
function outputsOf(n: UpstreamNode): OutputHint[] {
  const hints = NODE_OUTPUTS[n.type]?.(n.config) ?? [];
  const c = n.config as { continueOnError?: boolean };
  return c.continueOnError ? [...hints, { path: 'error', label: 'error (when it failed)' }] : hints;
}

// Keys of the object a Code node returns: `return { a, b: …, 'c-d': … }` or
// `export default async (…) => ({ … })`. Best effort; the last run's real output fills
// in anything this misses.
const RETURN_OBJECT = /(?:\breturn\s*\(?|export\s+default\s+(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\()\s*\{/g;

export function returnedKeys(code: string): string[] {
  const keys = new Set<string>();
  for (const m of code.matchAll(RETURN_OBJECT)) {
    for (const entry of topLevelEntries(code, m.index! + m[0].length - 1)) {
      const k = entry.trim().match(/^['"]?([A-Za-z_$][\w$-]*)['"]?\s*(?::|$)/);
      if (k) keys.add(k[1]);
    }
  }
  return [...keys];
}

// The comma-separated entries of the object literal opening at `start`, nested values skipped.
function topLevelEntries(src: string, start: number): string[] {
  const entries: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (depth === 1) cur += ch;
      if (ch === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      if (depth === 1) cur += ch;
      continue;
    }
    if ('{[('.includes(ch)) {
      depth++;
      continue;
    }
    if ('}])'.includes(ch)) {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ',') {
      entries.push(cur);
      cur = '';
    } else cur += ch;
  }
  entries.push(cur);
  return entries;
}

export const TRIGGER_SOURCE = 'trigger';
export const TRIGGER_GROUP = 'Trigger input';

const MAX_DEPTH = 5;
const MAX_PER_SOURCE = 300;
// Keys a template path can reach (see lib/template.ts).
const PATH_KEY = /^[A-Za-z0-9_$-]+$/;

export function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  return typeof v === 'object' ? 'object' : typeof v;
}

export function preview(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return JSON.stringify(v.length > 28 ? `${v.slice(0, 27)}…` : v);
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }`;
  }
  return String(v);
}

type Flat = { path: string; value: unknown; depth: number };

// { a: { b: 1 }, c: [{ d: 2 }], t: ['x'] } under "input" →
// input.a, input.a.b, input.c, input.c[0], input.c[0].d, input.t, input.t[0]
function flatten(value: unknown, path: string, depth: number, out: Flat[]) {
  if (out.length >= MAX_PER_SOURCE || depth >= MAX_DEPTH) return;
  if (Array.isArray(value)) {
    if (!value.length) return;
    const child = `${path}[0]`;
    out.push({ path: child, value: value[0], depth: depth + 1 });
    flatten(value[0], child, depth + 1, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (out.length >= MAX_PER_SOURCE) return;
    if (!PATH_KEY.test(k)) continue;
    const child = `${path}.${k}`;
    out.push({ path: child, value: v, depth: depth + 1 });
    flatten(v, child, depth + 1, out);
  }
}

function valueAt(root: unknown, rel: string): unknown {
  let cur = root;
  for (const part of rel.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function buildVariables(opts: {
  sample?: Record<string, unknown> | null;
  usedInputFields?: string[];
  lastRunInput?: Record<string, unknown> | null;
  upstream: UpstreamNode[];
  results?: Record<string, { output: unknown } | undefined>;
  secretNames: string[];
}): Variable[] {
  const vars: Variable[] = [];
  const seen = new Set<string>();
  const add = (v: Variable) => {
    if (seen.has(v.path)) return;
    seen.add(v.path);
    vars.push(v);
  };

  // Trigger: saved sample first, then the last run's input, then fields the graph already reads.
  const trigger = { source: TRIGGER_SOURCE, group: TRIGGER_GROUP };
  for (const source of [opts.sample, opts.lastRunInput]) {
    const flat: Flat[] = [];
    flatten(source ?? {}, 'input', 0, flat);
    for (const f of flat) {
      add({
        ...trigger,
        path: f.path,
        label: f.path.slice('input.'.length),
        type: typeOf(f.value),
        preview: preview(f.value),
        featured: f.depth === 1,
      });
    }
  }
  for (const p of opts.usedInputFields ?? []) {
    // Skip half-typed paths (input.cu while typing input.customer).
    if (vars.some((v) => v.path.startsWith(`input.${p}`) && v.path !== `input.${p}`)) continue;
    add({ ...trigger, path: `input.${p}`, label: p, type: 'used in this workflow', featured: !/[.[]/.test(p) });
  }
  add({ ...trigger, path: 'input', label: 'whole input', type: 'object', featured: true });

  for (const n of opts.upstream) {
    if (n.type === 'trigger') continue;
    const group = { source: n.id, group: n.name || n.id };
    const base = `nodes.${n.id}.output`;
    const result = opts.results?.[n.id];
    const known = outputsOf(n);
    for (const k of known) {
      const v = result ? valueAt(result.output, k.path) : undefined;
      add({
        ...group,
        path: `${base}.${k.path}`,
        label: k.label,
        type: v === undefined ? undefined : typeOf(v),
        preview: preview(v),
        featured: true,
      });
    }
    // Real keys from the last run.
    const flat: Flat[] = [];
    flatten(result?.output, base, 0, flat);
    for (const f of flat) {
      add({ ...group, path: f.path, label: f.path.slice(base.length + 1), type: typeOf(f.value), preview: preview(f.value) });
    }
    add({ ...group, path: base, label: 'whole output', type: 'object', featured: known.length === 0 });
  }

  const run = { source: 'run', group: 'This run' };
  add({ ...run, path: 'run.id', label: 'run id', type: 'string' });
  add({ ...run, path: 'run.trigger', label: 'started by (api, schedule, webhook, manual)', type: 'string' });
  add({ ...run, path: 'run.attempt', label: 'attempt number', type: 'number' });

  for (const s of opts.secretNames) {
    add({ source: 'secrets', group: 'Secrets', path: `secrets.${s}`, label: s, type: 'secret', featured: true });
  }
  return vars;
}

// Best matches first: path prefix, then substring of path or label. Sources stay together.
export function filterVariables(vars: Variable[], query: string): Variable[] {
  const q = query.trim().toLowerCase();
  if (!q) return vars;
  const scored: { v: Variable; score: number; i: number }[] = [];
  vars.forEach((v, i) => {
    const path = v.path.toLowerCase();
    const score = path.startsWith(q)
      ? 0
      : path.includes(q)
        ? 1
        : v.label.toLowerCase().includes(q) || v.group.toLowerCase().includes(q)
          ? 2
          : -1;
    if (score >= 0) scored.push({ v, score, i });
  });
  const best = new Map<string, number>();
  for (const s of scored) best.set(s.v.source, Math.min(best.get(s.v.source) ?? 9, s.score));
  const order = new Map<string, number>();
  for (const v of vars) if (!order.has(v.source)) order.set(v.source, order.size);
  return scored
    .sort(
      (a, b) =>
        best.get(a.v.source)! - best.get(b.v.source)! ||
        order.get(a.v.source)! - order.get(b.v.source)! ||
        a.score - b.score ||
        a.i - b.i
    )
    .map((s) => s.v);
}

export function hasTriggerFields(vars: Variable[]) {
  return vars.some((v) => v.source === TRIGGER_SOURCE && v.path !== 'input');
}

// A real path for placeholders, e.g. {{input.email}}.
export function examplePath(vars: Variable[], fallback = 'input.name') {
  return vars.find((v) => v.source === TRIGGER_SOURCE && v.path !== 'input' && v.type !== 'object')?.path ?? fallback;
}

export type TemplateScope = {
  // The node being edited, and every node on the canvas (id → name).
  selfId?: string;
  nodeNames?: Record<string, string>;
};

const REF = /\{\{\s*([\w.[\]$-]+)\s*\}\}/g;
const RUN_KEYS = new Set(['run', 'run.id', 'run.trigger', 'run.attempt']);

// Problems with the {{…}} references in a field, in plain words. Empty when all resolve.
export function checkTemplate(text: string, vars: Variable[], scope: TemplateScope): string[] {
  const problems = new Set<string>();
  const known = new Set(vars.map((v) => v.path));
  for (const m of text.matchAll(REF)) {
    const path = m[1];
    const [root, second] = path.split(/[.[]/);
    if (root === 'nodes' || root === 'steps') {
      const name = scope.nodeNames?.[second];
      if (!second) problems.add(`{{${path}}} needs a step id, e.g. nodes.<id>.output`);
      else if (second === scope.selfId) {
        problems.add(`{{${path}}} is this step's own output, which doesn't exist yet. Use a step that runs before it.`);
      } else if (!name) problems.add(`{{${path}}}: there is no step with id "${second}".`);
      else if (!vars.some((v) => v.source === second)) {
        problems.add(`{{${path}}}: "${name}" doesn't run before this step. Connect it earlier in the flow.`);
      }
    } else if (root === 'secrets') {
      if (!known.has(path)) problems.add(`{{${path}}}: no secret named "${second ?? ''}" in this workspace.`);
    } else if (root === 'run') {
      if (!RUN_KEYS.has(path)) problems.add(`{{${path}}}: runs only have id, trigger and attempt.`);
    } else if (root === 'input') {
      // Only flag when the trigger's fields are known and this one isn't among them.
      const fromSample = vars.filter((v) => v.source === TRIGGER_SOURCE && v.type !== 'used in this workflow');
      if (fromSample.length > 1 && !fromSample.some((v) => v.path === path || v.path.startsWith(path + '.'))) {
        const leaf = path.split('.').pop()!.toLowerCase();
        const close = fromSample.find((v) => v.path !== 'input' && v.label.toLowerCase().includes(leaf));
        problems.add(
          `{{${path}}} isn't in the trigger's sample input${close ? `. Did you mean {{${close.path}}}?` : '.'}`
        );
      }
    } else {
      problems.add(`{{${path}}}: unknown variable. Start with input, nodes, secrets or run.`);
    }
  }
  return [...problems];
}
