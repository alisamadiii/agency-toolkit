import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { runStep as runStepTable, secret, workspace, type run } from '@/db/schema';
import { decrypt } from '@/lib/crypto';
import { topoOrder, type GraphEdge, type GraphNode, type Step } from '@/lib/schemas';

import { sendToChannel, type SendResult } from '@/lib/channels/senders';
import { channelForSend } from '@/lib/service';
import { runIntegrationAction } from '@/lib/integrations';
import { renderText } from '@/lib/template';

import { evaluateIf } from './conditions';
import { runStep, type StepResult } from './steps';

type RunRow = typeof run.$inferSelect;

export type RunOutcome = {
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  output: unknown;
  error: string | null;
};

// Nodes of one run that may execute at the same time.
const PARALLEL_NODES = 4;

type EdgeState = 'pending' | 'live' | 'dead';
type NodeState = 'waiting' | 'running' | 'success' | 'failed' | 'skipped';

// Executes a claimed run's graph. A node runs once all its incoming connections are
// resolved and at least one is live; branches not taken by an IF (and everything only
// reachable through them) are skipped. `signal` aborts on cancel or whole-run timeout.
export async function executeRun(
  row: RunRow,
  signal: AbortSignal,
  reason: () => 'cancelled' | 'timeout' | null
): Promise<RunOutcome> {
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, row.workspaceId));
  const secrets: Record<string, string> = {};
  for (const s of await db.select().from(secret).where(eq(secret.workspaceId, row.workspaceId))) {
    try {
      secrets[s.name] = decrypt(s.value);
    } catch {
      // Unreadable (MASTER_KEY changed); leave it out.
    }
  }
  const mask = masker(Object.values(secrets));

  const { nodes, edges } = row.graph;
  const order = topoOrder(
    nodes.map((n) => n.id),
    edges
  ) ?? nodes.map((n) => n.id);
  const position = new Map(order.map((id, i) => [id, i]));
  const incoming = new Map<string, GraphEdge[]>(nodes.map((n) => [n.id, []]));
  const outgoing = new Map<string, GraphEdge[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    incoming.get(e.target)?.push(e);
    outgoing.get(e.source)?.push(e);
  }

  const edgeState = new Map<string, EdgeState>(edges.map((e) => [e.id, 'pending']));
  const nodeState = new Map<string, NodeState>(nodes.map((n) => [n.id, 'waiting']));
  const results: Record<string, { status: string; output: unknown }> = {};

  // Halting stops the rest of the graph (hard failure); in-flight nodes are aborted.
  const halt = new AbortController();
  const onOuterAbort = () => halt.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });
  let firstError: string | null = null;

  const record = (node: GraphNode, values: Partial<typeof runStepTable.$inferInsert>) =>
    db
      .insert(runStepTable)
      .values({
        runId: row.id,
        stepId: node.id,
        position: position.get(node.id) ?? 0,
        type: node.type,
        status: 'running',
        ...values,
      })
      .returning({ id: runStepTable.id });

  const resolveOutgoing = (node: GraphNode, live: boolean, branch?: boolean) => {
    for (const e of outgoing.get(node.id) ?? []) {
      const take = live && (branch === undefined || e.sourceHandle === String(branch));
      edgeState.set(e.id, take ? 'live' : 'dead');
    }
  };

  const ctx = () => ({
    input: row.input,
    nodes: results,
    // Older templates used {{steps.<id>...}}.
    steps: results,
    secrets,
    run: { id: row.id, attempt: row.attempt, trigger: row.trigger },
  });

  async function execute(node: GraphNode) {
    nodeState.set(node.id, 'running');
    const [rec] = await record(node, {});
    const started = Date.now();
    let result: StepResult;
    let attempts = 1;
    let branch: boolean | undefined;

    if (node.type === 'trigger') {
      result = { ok: true, output: row.input };
    } else if (node.type === 'if') {
      try {
        branch = evaluateIf(node.config, ctx());
        result = { ok: true, output: { result: branch } };
      } catch (error) {
        result = { ok: false, output: null, error: error instanceof Error ? error.message : String(error) };
      }
    } else {
      let once: () => Promise<StepResult>;
      if (node.type === 'notify') {
        const config = node.config;
        once = () => sendNotify(row.workspaceId, config, ctx());
      } else if (node.type === 'app') {
        const config = node.config;
        once = () => runApp(row, node.id, config, ctx());
      } else {
        const step: Step =
          node.type === 'http'
            ? { ...node.config, id: node.id, type: 'http' }
            : { ...node.config, id: node.id, type: 'script' };
        once = () => runStep(step, { ctx: ctx(), allowedHosts: ws.allowedHosts, signal: halt.signal });
      }
      result = { ok: false, output: null, error: 'Not run' };
      attempts = 0;
      for (; attempts <= node.config.retries && !halt.signal.aborted; attempts++) {
        if (attempts > 0) await sleep(Math.min(1000 * 2 ** (attempts - 1), 10_000), halt.signal);
        result = await once();
        if (result.ok) break;
      }
      attempts = Math.max(attempts, 1);
    }

    const continueOnError = 'continueOnError' in node.config && node.config.continueOnError;
    await db
      .update(runStepTable)
      .set({
        status: result.ok ? 'success' : 'failed',
        attempts,
        output: maskJson(result.output, mask),
        error: result.error ? mask(result.error) : null,
        logs: result.logs ? mask(result.logs) : null,
        durationMs: Date.now() - started,
      })
      .where(eq(runStepTable.id, rec.id));

    if (result.ok) {
      nodeState.set(node.id, 'success');
      results[node.id] = { status: 'success', output: result.output };
      resolveOutgoing(node, true, branch);
    } else {
      nodeState.set(node.id, 'failed');
      firstError ??= `Node "${node.name}" (${node.id}): ${mask(result.error ?? 'failed')}`;
      results[node.id] = { status: 'failed', output: { error: mask(result.error ?? 'failed') } };
      if (continueOnError) {
        resolveOutgoing(node, true);
      } else {
        resolveOutgoing(node, false);
        halt.abort();
      }
    }
  }

  const skip = async (node: GraphNode) => {
    nodeState.set(node.id, 'skipped');
    results[node.id] = { status: 'skipped', output: null };
    resolveOutgoing(node, false);
    await record(node, { status: 'skipped', attempts: 0, durationMs: 0 });
  };

  const inFlight = new Set<Promise<void>>();
  const byId = new Map(nodes.map((n) => [n.id, n]));

  try {
    for (;;) {
      let progressed = false;
      for (const id of order) {
        if (nodeState.get(id) !== 'waiting') continue;
        const node = byId.get(id)!;
        const ins = incoming.get(id) ?? [];
        if (halt.signal.aborted) {
          await skip(node);
          progressed = true;
          continue;
        }
        if (node.type !== 'trigger' && ins.length === 0) {
          // Not connected to anything: never runs.
          await skip(node);
          progressed = true;
          continue;
        }
        if (ins.some((e) => edgeState.get(e.id) === 'pending')) continue;
        if (node.type !== 'trigger' && ins.every((e) => edgeState.get(e.id) === 'dead')) {
          await skip(node);
          progressed = true;
          continue;
        }
        if (inFlight.size >= PARALLEL_NODES) continue;
        const p: Promise<void> = execute(node).finally(() => inFlight.delete(p));
        inFlight.add(p);
        progressed = true;
      }
      if (inFlight.size === 0 && !progressed) break;
      if (inFlight.size > 0 && !progressed) await Promise.race(inFlight);
    }
  } finally {
    signal.removeEventListener('abort', onOuterAbort);
  }

  // Output: what the end nodes produced.
  const leaves = nodes.filter((n) => (outgoing.get(n.id) ?? []).length === 0 && nodeState.get(n.id) === 'success');
  const output =
    leaves.length === 0 ? null : leaves.length === 1 ? results[leaves[0].id].output : Object.fromEntries(leaves.map((n) => [n.id, results[n.id].output]));

  const stopped = reason();
  if (stopped) {
    return {
      status: stopped,
      output: maskJson(output, mask),
      error: stopped === 'timeout' ? `Run exceeded ${row.timeoutSec}s` : 'Cancelled',
    };
  }
  const failed = halt.signal.aborted;
  return { status: failed ? 'failed' : 'success', output: maskJson(output, mask), error: failed ? firstError : null };
}

// App node (e.g. Google Calendar): runs with the workspace's own connection. The
// idempotency key is per run + node, so a retry never books the same thing twice.
async function runApp(
  row: RunRow,
  nodeId: string,
  config: Extract<GraphNode, { type: 'app' }>['config'],
  ctx: Record<string, unknown>
): Promise<StepResult> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(config.params)) params[k] = renderText(v, ctx);
  try {
    const output = await Promise.race([
      runIntegrationAction({
        workspaceId: row.workspaceId,
        provider: config.provider,
        action: config.action,
        params,
        idempotencyKey: `${row.id}:${nodeId}`,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${config.timeoutSec}s`)), config.timeoutSec * 1000)
      ),
    ]);
    return { ok: true, output, logs: `${config.provider}.${config.action}` };
  } catch (error) {
    return { ok: false, output: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// Notify node: render the templates and send through the workspace's own channel.
async function sendNotify(
  workspaceId: string,
  config: Extract<GraphNode, { type: 'notify' }>['config'],
  ctx: Record<string, unknown>
): Promise<StepResult> {
  let channel;
  try {
    channel = await channelForSend(workspaceId, config.channelId);
  } catch {
    return { ok: false, output: null, error: 'Notification channel not found (deleted?)' };
  }
  if (!channel.row.enabled) return { ok: false, output: null, error: `Channel "${channel.row.name}" is turned off` };
  const title = renderText(config.title, ctx) || 'Notification';
  const message = renderText(config.message, ctx);
  const to = renderText(config.to, ctx);
  const sent = await Promise.race([
    sendToChannel(channel.row.type, channel.config, { title, message, to }),
    new Promise<SendResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: `Timed out after ${config.timeoutSec}s` }), config.timeoutSec * 1000)
    ),
  ]);
  const output = { ok: sent.ok, channel: channel.row.name, type: channel.row.type, to: sent.to ?? (to || undefined), title, message };
  return sent.ok
    ? { ok: true, output, logs: `Sent via ${channel.row.type} "${channel.row.name}"${sent.to ? ` to ${sent.to}` : ''}` }
    : { ok: false, output, error: sent.error ?? 'Send failed' };
}

function masker(values: string[]) {
  const secrets = values.filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
  return (text: string) => secrets.reduce((t, s) => t.split(s).join('***'), text);
}

function maskJson(value: unknown, mask: (s: string) => string): unknown {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(mask(JSON.stringify(value)));
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true }
    );
  });
}
