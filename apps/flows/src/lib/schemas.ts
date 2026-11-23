import { z } from 'zod';

import { CHANNEL_TYPES } from '@/lib/channels/registry';

// Shared by the API (request validation), the engine and the OpenAPI spec.

const stepId = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/, 'Letters, digits, _ or -, starting with a letter');

const stepBase = {
  id: stepId,
  name: z.string().max(200).optional(),
  timeoutSec: z.number().int().min(1).max(300).default(30),
  // Extra tries for this step before it counts as failed.
  retries: z.number().int().min(0).max(5).default(0),
  // Keep going to the next step even if this one fails.
  continueOnError: z.boolean().default(false),
};

export const httpStepSchema = z.object({
  ...stepBase,
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  // Supports {{input.x}}, {{steps.<id>.output...}} and {{secrets.NAME}}.
  url: z.string().min(1).max(4000),
  headers: z.record(z.string(), z.string()).default({}),
  // Objects are sent as JSON; strings are sent as-is. Templates work inside both.
  body: z.unknown().optional(),
});

export const scriptStepSchema = z.object({
  ...stepBase,
  type: z.literal('script'),
  // ES module run by Deno. Default export receives { input, steps, secrets } and returns JSON.
  code: z.string().min(1).max(100_000),
});

export const stepSchema = z.discriminatedUnion('type', [httpStepSchema, scriptStepSchema]);
export type Step = z.output<typeof stepSchema>;
export type HttpStep = z.output<typeof httpStepSchema>;
export type ScriptStep = z.output<typeof scriptStepSchema>;

export const stepsSchema = z
  .array(stepSchema)
  .min(1)
  .max(50)
  .refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, {
    message: 'Step ids must be unique',
  });

// ---------- Graph (canvas) ----------

const nodeBase = {
  id: stepId,
  name: z.string().min(1).max(200),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
};

const omitStepKeys = { id: true, type: true, name: true } as const;
export const httpConfigSchema = httpStepSchema.omit(omitStepKeys);
export const codeConfigSchema = scriptStepSchema.omit(omitStepKeys);

export const IF_OPERATORS = ['equals', 'notEquals', 'contains', 'gt', 'lt', 'isEmpty', 'isNotEmpty', 'isTrue'] as const;
export type IfOperator = (typeof IF_OPERATORS)[number];

export const conditionSchema = z.object({
  left: z.string().max(2000).default(''),
  op: z.enum(IF_OPERATORS).default('equals'),
  right: z.string().max(2000).default(''),
});

export const ifConfigSchema = z.object({
  conditions: z.array(conditionSchema).min(1).max(20),
  combine: z.enum(['and', 'or']).default('and'),
});

export const notifyConfigSchema = z.object({
  // One of the workspace's notification channels.
  channelId: z.uuid(),
  title: z.string().max(500).default(''),
  message: z.string().min(1).max(10_000),
  // Recipient override: email(s), phone, chat id. Empty uses the channel default.
  to: z.string().max(1000).default(''),
  timeoutSec: z.number().int().min(1).max(120).default(30),
  retries: z.number().int().min(0).max(5).default(0),
  continueOnError: z.boolean().default(false),
});

export const graphNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...nodeBase, type: z.literal('trigger'), config: z.object({}).default({}) }),
  z.object({ ...nodeBase, type: z.literal('http'), config: httpConfigSchema }),
  z.object({ ...nodeBase, type: z.literal('code'), config: codeConfigSchema }),
  z.object({ ...nodeBase, type: z.literal('if'), config: ifConfigSchema }),
  z.object({ ...nodeBase, type: z.literal('notify'), config: notifyConfigSchema }),
]);
export type GraphNode = z.output<typeof graphNodeSchema>;
export type NodeType = GraphNode['type'];

export const graphEdgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: stepId,
  target: stepId,
  // Required for edges leaving an IF node.
  sourceHandle: z.enum(['true', 'false']).nullish(),
});
export type GraphEdge = z.output<typeof graphEdgeSchema>;

export const graphSchema = z
  .object({
    nodes: z.array(graphNodeSchema).min(1).max(100),
    edges: z.array(graphEdgeSchema).max(300).default([]),
  })
  .superRefine((graph, ctx) => {
    for (const message of graphProblems(graph)) ctx.addIssue({ code: 'custom', message });
  });
export type Graph = z.output<typeof graphSchema>;

// Structural rules shared by the API and the canvas.
export function graphProblems(graph: { nodes: { id: string; type: string }[]; edges: GraphEdge[] }): string[] {
  const problems: string[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (byId.size !== graph.nodes.length) problems.push('Node ids must be unique');
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) problems.push('A workflow needs exactly one trigger node');

  const seen = new Set<string>();
  for (const e of graph.edges) {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target) {
      problems.push(`Connection ${e.source} → ${e.target} points at a missing node`);
      continue;
    }
    if (e.source === e.target) problems.push(`${e.source} can't connect to itself`);
    if (target.type === 'trigger') problems.push('Nothing can connect into the trigger');
    if (source.type === 'if' && !e.sourceHandle) problems.push(`Connections from IF node ${e.source} need a true or false output`);
    const key = `${e.source}:${e.sourceHandle ?? ''}->${e.target}`;
    if (seen.has(key)) problems.push(`Duplicate connection ${e.source} → ${e.target}`);
    seen.add(key);
  }
  if (!problems.length && hasCycle(graph.nodes.map((n) => n.id), graph.edges)) {
    problems.push('Connections form a loop; workflows must flow one way');
  }
  return problems;
}

export function hasCycle(ids: string[], edges: { source: string; target: string }[]): boolean {
  return topoOrder(ids, edges) === null;
}

// Kahn's algorithm. Null when there is a cycle.
export function topoOrder(ids: string[], edges: { source: string; target: string }[]): string[] | null {
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const e of edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of edges) {
      if (e.source !== id) continue;
      const left = (indegree.get(e.target) ?? 0) - 1;
      indegree.set(e.target, left);
      if (left === 0) queue.push(e.target);
    }
  }
  return order.length === ids.length ? order : null;
}

// Old linear `steps` become trigger → step1 → step2 ..., laid out left to right.
export function stepsToGraph(steps: Step[]): Graph {
  const nodes: GraphNode[] = [{ id: 'trigger', name: 'Trigger', type: 'trigger', position: { x: 0, y: 0 }, config: {} }];
  steps.forEach((step, i) => {
    const position = { x: (i + 1) * 280, y: 0 };
    const name = step.name ?? step.id;
    if (step.type === 'http') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, type: _t, name: _n, ...config } = step;
      nodes.push({ id, name, type: 'http', position, config });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, type: _t, name: _n, ...config } = step;
      nodes.push({ id, name, type: 'code', position, config });
    }
  });
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id, sourceHandle: null }));
  return { nodes, edges };
}

const inputSchema = z.record(z.string(), z.unknown());

const workflowFields = {
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  enabled: z.boolean().default(true),
  // The canvas. `steps` (a straight line) is accepted as a shortcut and converted.
  graph: graphSchema.optional(),
  steps: stepsSchema.optional(),
  timeoutSec: z.number().int().min(1).max(3600).default(300),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  onFinishUrl: z.url().nullish(),
  // Run alerts to the workspace's own channels.
  alertChannelIds: z.array(z.uuid()).max(20).default([]),
  alertOn: z.enum(['failure', 'always', 'never']).default('failure'),
};

const withGraph = <T extends { graph?: Graph; steps?: Step[] }>(value: T) => {
  const { steps, ...rest } = value;
  return { ...rest, graph: value.graph ?? (steps ? stepsToGraph(steps) : undefined) };
};

export const workflowCreateSchema = z
  .object(workflowFields)
  .refine((v) => v.graph || v.steps, { message: 'Send a graph (or steps)' })
  .transform((v) => withGraph(v) as Omit<typeof v, 'steps' | 'graph'> & { graph: Graph });
// PATCH: only the sent fields change (no defaults, or a partial update would reset them).
export const workflowUpdateSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    enabled: z.boolean(),
    graph: graphSchema,
    steps: stepsSchema,
    timeoutSec: z.number().int().min(1).max(3600),
    maxAttempts: z.number().int().min(1).max(10),
    onFinishUrl: z.url().nullable(),
    alertChannelIds: z.array(z.uuid()).max(20),
    alertOn: z.enum(['failure', 'always', 'never']),
  })
  .partial()
  .transform((v) => withGraph(v));

export const scheduleCreateSchema = z.object({
  cron: z.string().min(1).max(200),
  timezone: z.string().default('UTC'),
  enabled: z.boolean().default(true),
  input: inputSchema.default({}),
});
export const scheduleUpdateSchema = z
  .object({
    cron: z.string().min(1).max(200),
    timezone: z.string(),
    enabled: z.boolean(),
    input: inputSchema,
  })
  .partial();

export const runCreateSchema = z.object({
  input: inputSchema.default({}),
});

export const workspaceCreateSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  allowedHosts: z.array(z.string().min(1).max(253)).max(100).default([]),
  maxWorkflows: z.number().int().min(1).max(10_000).default(50),
  maxConcurrentRuns: z.number().int().min(1).max(100).default(2),
});
export const workspaceUpdateSchema = z
  .object({
    name: z.string().min(1).max(200),
    allowedHosts: z.array(z.string().min(1).max(253)).max(100),
    maxWorkflows: z.number().int().min(1).max(10_000),
    maxConcurrentRuns: z.number().int().min(1).max(100),
  })
  .partial();

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(200),
});

export const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'UPPER_SNAKE_CASE');
export const secretPutSchema = z.object({
  value: z.string().max(10_000),
});

export const channelCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(CHANNEL_TYPES),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()),
});
export const channelUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  // Secret fields left as the mask (or omitted) keep their stored value.
  config: z.record(z.string(), z.unknown()).optional(),
});

export const validateSchema = z.object({
  graph: graphSchema.optional(),
  steps: stepsSchema.optional(),
  cron: z.string().optional(),
  timezone: z.string().default('UTC'),
});
