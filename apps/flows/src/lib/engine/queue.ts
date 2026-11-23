import { and, eq, inArray } from 'drizzle-orm';

import { db, sql } from '@/db';
import { run, workflow, type RunTrigger } from '@/db/schema';

export const RUN_CHANNEL = 'flows_run';

export async function notifyWorkers() {
  await sql.notify(RUN_CHANNEL, '').catch(() => {});
}

export class EnqueueError extends Error {}

// Adds a run for a workflow with a snapshot of its current graph.
export async function enqueueRun(opts: {
  workflowId: string;
  workspaceId: string;
  trigger: RunTrigger;
  input?: Record<string, unknown>;
}) {
  const [wf] = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, opts.workflowId), eq(workflow.workspaceId, opts.workspaceId)));
  if (!wf) throw new EnqueueError('Workflow not found');
  if (!wf.enabled) throw new EnqueueError('Workflow is disabled');

  const [row] = await db
    .insert(run)
    .values({
      workflowId: wf.id,
      workspaceId: wf.workspaceId,
      trigger: opts.trigger,
      input: opts.input ?? {},
      graph: wf.graph,
      timeoutSec: wf.timeoutSec,
      maxAttempts: wf.maxAttempts,
      workflowVersion: wf.version,
    })
    .returning();
  await notifyWorkers();
  return row;
}

// Queued runs are cancelled at once; running ones are flagged and stopped by their worker.
export async function cancelRun(runId: string, workspaceId: string) {
  const [queued] = await db
    .update(run)
    .set({ status: 'cancelled', finishedAt: new Date(), error: 'Cancelled' })
    .where(and(eq(run.id, runId), eq(run.workspaceId, workspaceId), eq(run.status, 'queued')))
    .returning({ id: run.id });
  if (queued) return 'cancelled' as const;

  const [running] = await db
    .update(run)
    .set({ cancelRequested: true })
    .where(and(eq(run.id, runId), eq(run.workspaceId, workspaceId), inArray(run.status, ['running'])))
    .returning({ id: run.id });
  return running ? ('cancelling' as const) : null;
}

