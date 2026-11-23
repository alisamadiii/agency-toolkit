import { desc, inArray } from 'drizzle-orm';
import { Workflow as WorkflowIcon } from 'lucide-react';
import Link from 'next/link';

import { HubBadge, RunStatus } from '@/components/hub/badge';
import { EmptyState, HubCard } from '@/components/hub/card';
import { Button } from '@/components/ui/button';
import { db } from '@/db';
import { run } from '@/db/schema';
import { roleAtLeast } from '@/lib/embed';
import * as service from '@/lib/service';

import { embedPage } from '../session';

export default async function IframeWorkflows() {
  const { session, ws } = await embedPage();
  const [workflows, schedules] = await Promise.all([service.listWorkflows(ws.id), service.listSchedules(ws.id)]);
  const ids = workflows.map((w) => w.id);
  const lastRuns = ids.length
    ? await db
        .selectDistinctOn([run.workflowId], { workflowId: run.workflowId, status: run.status, queuedAt: run.queuedAt })
        .from(run)
        .where(inArray(run.workflowId, ids))
        .orderBy(run.workflowId, desc(run.queuedAt))
    : [];
  const last = new Map(lastRuns.map((r) => [r.workflowId, r]));
  const canEdit = roleAtLeast(session.role, 'content-editor');

  return (
    <HubCard>
      <div className="flex flex-wrap items-center gap-3 border-b border-divider px-6 py-4">
        <h2 className="text-base font-semibold">
          Workflows <span className="font-normal text-faint">{workflows.length}</span>
        </h2>
        <div className="flex-1" />
        {canEdit && (
          <Button asChild>
            <Link href="/iframe/workflows/new">New workflow</Link>
          </Button>
        )}
      </div>
      {workflows.length === 0 ? (
        <EmptyState
          icon={<WorkflowIcon className="size-5" />}
          title="No workflows yet"
          text="A workflow runs steps like calling an API, running code or sending a message. Put it on a schedule to make it a cron job."
        />
      ) : (
        <div role="table" className="text-[13px]">
          <div
            role="row"
            className="hidden h-[38px] grid-cols-[minmax(0,2fr)_110px_140px_150px] items-center gap-4 border-b border-divider bg-sidebar px-6 text-xs font-medium text-dim sm:grid"
          >
            <span>Name</span>
            <span>Status</span>
            <span>Schedules</span>
            <span>Last run</span>
          </div>
          {workflows.map((w) => {
            const sched = schedules.filter((s) => s.workflowId === w.id && s.enabled);
            const lr = last.get(w.id);
            return (
              <Link
                key={w.id}
                href={`/iframe/workflows/${w.id}`}
                role="row"
                className="grid min-h-[60px] grid-cols-1 items-center gap-1 border-b border-divider px-6 py-3 last:border-b-0 hover:bg-sidebar sm:grid-cols-[minmax(0,2fr)_110px_140px_150px] sm:gap-4"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{w.name}</span>
                  <span className="block truncate text-xs text-dim">
                    {w.description || `${w.graph.nodes.length - 1} step${w.graph.nodes.length === 2 ? '' : 's'}`}
                  </span>
                </span>
                <span>{w.enabled ? <HubBadge tone="success">Active</HubBadge> : <HubBadge>Paused</HubBadge>}</span>
                <span className="font-mono text-xs text-ink-3">
                  {sched.length === 0 ? <span className="font-sans text-faint">None</span> : sched.map((s) => s.cron).join(', ')}
                </span>
                <span className="flex flex-col gap-0.5">
                  {lr ? (
                    <>
                      <RunStatus status={lr.status} />
                      <span className="text-xs text-faint">{lr.queuedAt.toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="text-faint">Never</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </HubCard>
  );
}
