import Link from 'next/link';

import { AutoRefresh } from '@/components/auto-refresh';
import { CancelRun } from '@/components/dashboard-forms';
import { FlowEditor } from '@/components/flow/flow-editor';
import { HubCard, HubCardHeader } from '@/components/hub/card';
import { RunStatus } from '@/components/hub/badge';
import { PageHeader } from '@/components/hub/page-header';
import type { getRun } from '@/lib/service';

type Run = Awaited<ReturnType<typeof getRun>>;

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="text-[13px] text-faint">—</p>;
  return <pre className="max-h-80 overflow-auto rounded-inner bg-subtle p-3 font-mono text-xs text-ink-3">{JSON.stringify(value, null, 2)}</pre>;
}

// One run: status, input, the canvas painted with node results, each node's output and logs.
export function RunDetail({
  r,
  workflowName,
  workspaceName,
  backHref,
  canCancel,
}: {
  r: Run;
  workflowName: string;
  workspaceName: string;
  backHref: string;
  canCancel: boolean;
}) {
  const names = new Map(r.graph.nodes.map((n) => [n.id, n.name]));
  const live = r.status === 'queued' || r.status === 'running';
  const duration =
    r.startedAt && r.finishedAt ? `${((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s` : null;

  return (
    <div className="flex flex-col gap-5">
      {live && <AutoRefresh />}
      <Link href={backHref} className="text-[13px] text-dim hover:text-ink">
        ← {workflowName}
      </Link>
      <PageHeader
        title={
          <>
            Run <RunStatus status={r.status} />
          </>
        }
        description={
          <>
            {r.trigger} · attempt {r.attempt}/{r.maxAttempts} · {r.queuedAt.toLocaleString()}
            {duration && ` · ${duration}`}
          </>
        }
        actions={live && canCancel ? <CancelRun workspaceId={r.workspaceId} runId={r.id} /> : undefined}
      />
      {r.error && <p className="rounded-inner bg-danger-soft px-4 py-3 text-sm text-danger">{r.error}</p>}

      <div className="h-[50vh] overflow-hidden rounded-card border border-line bg-surface">
        <FlowEditor
          readOnly
          workspaceId={r.workspaceId}
          workspaceName={workspaceName}
          workflow={{
            id: r.workflowId,
            name: workflowName,
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

      <HubCard>
        <HubCardHeader title="Input" />
        <div className="px-6 py-4">
          <Json value={r.input} />
        </div>
      </HubCard>

      {r.steps.map((s) => (
        <HubCard key={s.id}>
          <HubCardHeader
            title={
              <>
                {names.get(s.stepId) ?? s.stepId} <span className="font-normal text-faint">· {s.type}</span>
              </>
            }
            action={
              <div className="flex items-center gap-3 text-[13px] text-dim">
                {s.durationMs != null && <span>{s.durationMs} ms</span>}
                {s.attempts > 1 && <span>{s.attempts} tries</span>}
                <RunStatus status={s.status} />
              </div>
            }
            divided={Boolean(s.error || s.logs || s.output != null)}
          />
          {(s.error || s.logs || s.output != null) && (
            <div className="grid gap-3 px-6 py-4">
              {s.error && <p className="text-sm text-danger">{s.error}</p>}
              {s.logs && (
                <pre className="scrollbar-on-dark max-h-60 overflow-auto rounded-inner bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
                  {s.logs}
                </pre>
              )}
              {s.output != null && <Json value={s.output} />}
            </div>
          )}
        </HubCard>
      ))}

      <HubCard>
        <HubCardHeader title="Output" />
        <div className="px-6 py-4">
          <Json value={r.output} />
        </div>
      </HubCard>
    </div>
  );
}
