import type { Edge, Node } from '@xyflow/react';

import { findAction } from '@/lib/integrations/registry';
import type { Graph, GraphEdge, GraphNode, NodeType } from '@/lib/schemas';

// What the canvas keeps per node. `status` paints the last run on the card.
export type FlowNodeData = {
  name: string;
  config: GraphNode['config'];
  status?: string;
};
export type FlowNode = Node<FlowNodeData, NodeType>;

export const NODE_META: Record<NodeType, { label: string; description: string }> = {
  trigger: { label: 'Trigger', description: 'Schedule, trigger URL, API or Run now' },
  http: { label: 'HTTP Request', description: 'Call any URL on the allow-list' },
  code: { label: 'Code', description: 'JavaScript/TypeScript in a sandbox' },
  if: { label: 'IF', description: 'Branch on a condition' },
  notify: { label: 'Notify', description: 'Slack, email, SMS, WhatsApp…' },
  app: { label: 'App', description: 'A connected app such as Google Calendar' },
};

// The workspace's connected apps, for the palette and node panel.
export type IntegrationOption = { provider: string; label: string; connected: boolean; accountEmail?: string };

// The workspace's channels, for labels on Notify nodes and the panel.
export type ChannelOption = { id: string; name: string; type: string; enabled: boolean; recipient: boolean };

export function defaultConfig(type: NodeType): GraphNode['config'] {
  switch (type) {
    case 'http':
      return { method: 'GET', url: 'https://', headers: {}, timeoutSec: 30, retries: 0, continueOnError: false };
    case 'code':
      return {
        code: 'export default async ({ input, nodes, secrets }) => {\n  // nodes.<id>.output holds earlier results\n  return { ok: true };\n};\n',
        timeoutSec: 30,
        retries: 0,
        continueOnError: false,
      };
    case 'if':
      return { conditions: [{ left: '', op: 'equals', right: '' }], combine: 'and' };
    case 'app':
      return { provider: 'google_calendar', action: '', params: {}, timeoutSec: 30, retries: 0, continueOnError: false } as unknown as GraphNode['config'];
    case 'notify':
      return { channelId: '', title: '', message: '', to: '', timeoutSec: 30, retries: 0, continueOnError: false } as unknown as GraphNode['config'];
    default:
      return {};
  }
}

export function toFlow(graph: Graph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { name: n.name, config: n.config },
      deletable: n.type !== 'trigger',
    })),
    edges: graph.edges.map(toFlowEdge),
  };
}

// IF branches get a tinted connector; the true/false tag sits on the node handle.
export function branchStyle(handle: string | null | undefined) {
  if (handle === 'true') return { stroke: '#10b981', strokeWidth: 2 };
  if (handle === 'false') return { stroke: '#ef4444', strokeWidth: 2 };
  return undefined;
}

export function toFlowEdge(e: GraphEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    style: branchStyle(e.sourceHandle),
  };
}

export function fromFlow(nodes: FlowNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map(
      (n) =>
        ({
          id: n.id,
          type: n.type,
          name: n.data.name,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
          config: n.data.config,
        }) as GraphNode
    ),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: (e.sourceHandle as 'true' | 'false' | null | undefined) ?? null,
    })),
  };
}

// Stable string for "unsaved changes" detection.
export function graphKey(graph: Graph) {
  return JSON.stringify(graph);
}

export function nextNodeId(type: NodeType, taken: Iterable<string>) {
  const used = new Set(taken);
  for (let i = 1; ; i++) {
    const id = `${type}_${i}`;
    if (!used.has(id)) return id;
  }
}

// Would adding source → target create a loop?
export function createsCycle(source: string, target: string, edges: { source: string; target: string }[]) {
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

// Every node that can reach `id` (for the variables helper).
export function upstreamOf(id: string, edges: { source: string; target: string }[]) {
  const result = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.target === cur && !result.has(e.source)) {
        result.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return result;
}

// One line under the node name.
export function summary(type: NodeType, config: GraphNode['config'], channels: ChannelOption[] = []): string {
  if (type === 'app') {
    const c = config as { provider: string; action: string; params: Record<string, string> };
    const action = findAction(c.provider, c.action);
    const hint = c.params.guestEmail || c.params.title || c.params.eventId || '';
    return `${action?.label ?? 'Pick an action'}${hint ? ` · ${hint}` : ''}`;
  }
  if (type === 'notify') {
    const c = config as { channelId: string; to: string };
    const ch = channels.find((x) => x.id === c.channelId);
    if (!ch) return 'Pick a channel';
    return c.to ? `${ch.name} → ${c.to}` : ch.name;
  }
  if (type === 'http') {
    const c = config as { method: string; url: string };
    return `${c.method} ${c.url.replace(/^https?:\/\//, '')}`;
  }
  if (type === 'code') {
    const lines = (config as { code: string }).code.split('\n').length;
    return `${lines} line${lines === 1 ? '' : 's'} of code`;
  }
  if (type === 'if') {
    const c = config as { conditions: { left: string; op: string; right: string }[]; combine: string };
    const first = c.conditions[0];
    const more = c.conditions.length > 1 ? ` ${c.combine} ${c.conditions.length - 1} more` : '';
    return first ? `${first.left || '…'} ${first.op} ${first.right}${more}` : 'No conditions';
  }
  return 'Starts the workflow';
}
