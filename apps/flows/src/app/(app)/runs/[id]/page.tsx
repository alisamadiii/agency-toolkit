import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AutoRefresh } from '@/components/auto-refresh';
import { CancelRun } from '@/components/dashboard-forms';
import { FlowEditor } from '@/components/flow/flow-editor';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { run, workflow } from '@/db/schema';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="text-xs text-muted-foreground">—</p>;
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
  );
}

export default async function RunPage({ params }: PageProps<'/runs/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [ref] = await db.select({ workspaceId: run.workspaceId }).from(run).where(eq(run.id, id));
  if (!ref) notFound();
  const r = await service.getRun(ref.workspaceId, id);
  const [wf] = await db.select().from(workflow).where(eq(workflow.id, r.workflowId));
  const ws = await service.getWorkspace(r.workspaceId);
  const names = new Map(r.graph.nodes.map((n) => [n.id, n.name]));
  const live = r.status === 'queued' || r.status === 'running';

  return (
    <div className="grid gap-6">
      {live && <AutoRefresh />}
      <div>
        <Link href={`/w/${r.workspaceId}/workflows/${r.workflowId}`} className="text-sm text-muted-foreground hover:underline">
          ← {wf?.name ?? 'Workflow'}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Run</h1>
          <StatusBadge status={r.status} />
          {live && <CancelRun workspaceId={r.workspaceId} runId={r.id} />}
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {r.id} · {r.trigger} · attempt {r.attempt}/{r.maxAttempts} · queued {r.queuedAt.toLocaleString()}
          {r.finishedAt && ` · finished ${r.finishedAt.toLocaleString()}`}
        </p>
        {r.error && <p className="mt-2 rounded-md bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{r.error}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
        </CardHeader>
        <CardContent>
          <Json value={r.input} />
        </CardContent>
      </Card>

      <div className="h-[55vh] overflow-hidden rounded-xl border">
        <FlowEditor
          readOnly
          workspaceId={r.workspaceId}
          workspaceName={ws.name}
          workflow={{
            id: r.workflowId,
            name: wf?.name ?? 'Workflow',
            enabled: true,
            description: null,
            timeoutSec: r.timeoutSec,
            maxAttempts: r.maxAttempts,
            onFinishUrl: null,
            alertOn: 'never',
            alertChannelIds: [],
            graph: r.graph,
          }}
          triggerUrl=""
          schedules={[]}
          secretNames={[]}
          runs={[]}
          initialRunId={r.id}
        />
      </div>

      {r.steps.map((result) => (
        <Card key={result.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-mono text-sm">
              {names.get(result.stepId) ?? result.stepId} <span className="text-muted-foreground">({result.type})</span>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {result.durationMs != null && <span>{result.durationMs} ms</span>}
              {result.attempts > 1 && <span>{result.attempts} tries</span>}
              <StatusBadge status={result.status} />
            </div>
          </CardHeader>
          {(result.error || result.logs || result.output != null) && (
            <CardContent className="grid gap-3">
              {result.error && <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
              {result.logs && (
                <pre className="scrollbar-on-dark max-h-60 overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">{result.logs}</pre>
              )}
              {result.output != null && <Json value={result.output} />}
            </CardContent>
          )}
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Output</CardTitle>
        </CardHeader>
        <CardContent>
          <Json value={r.output} />
        </CardContent>
      </Card>
    </div>
  );
}
