import { eq } from 'drizzle-orm';
import { History } from 'lucide-react';
import Link from 'next/link';

import { RunStatus } from '@/components/hub/badge';
import { EmptyState, HubCard } from '@/components/hub/card';
import { db } from '@/db';
import { workflow } from '@/db/schema';
import * as service from '@/lib/service';

import { embedPage } from '../../session';

function duration(r: { startedAt: Date | null; finishedAt: Date | null }) {
  if (!r.startedAt || !r.finishedAt) return '—';
  const ms = r.finishedAt.getTime() - r.startedAt.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default async function IframeRuns() {
  const { ws } = await embedPage();
  const [runs, wfs] = await Promise.all([
    service.listRuns(ws.id, { limit: 100 }),
    db.select({ id: workflow.id, name: workflow.name }).from(workflow).where(eq(workflow.workspaceId, ws.id)),
  ]);
  const names = new Map(wfs.map((w) => [w.id, w.name]));

  return (
    <HubCard>
      <div className="border-b border-divider px-6 py-4">
        <h2 className="text-base font-semibold">Recent runs</h2>
      </div>
      {runs.data.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="No runs yet" text="Runs show up here when a workflow is triggered or its schedule fires." />
      ) : (
        <div role="table" className="text-[13px]">
          <div className="hidden h-[38px] grid-cols-[130px_minmax(0,2fr)_100px_170px_90px] items-center gap-4 border-b border-divider bg-sidebar px-6 text-xs font-medium text-dim sm:grid">
            <span>Status</span>
            <span>Workflow</span>
            <span>Trigger</span>
            <span>Started</span>
            <span>Duration</span>
          </div>
          {runs.data.map((r) => (
            <Link
              key={r.id}
              href={`/iframe/runs/${r.id}`}
              className="grid min-h-[52px] grid-cols-2 items-center gap-2 border-b border-divider px-6 py-2.5 last:border-b-0 hover:bg-sidebar sm:grid-cols-[130px_minmax(0,2fr)_100px_170px_90px] sm:gap-4"
            >
              <RunStatus status={r.status} />
              <span className="truncate font-medium text-ink">{names.get(r.workflowId) ?? 'Deleted workflow'}</span>
              <span className="text-ink-3 capitalize">{r.trigger}</span>
              <span className="text-ink-3">{r.queuedAt.toLocaleString()}</span>
              <span className="text-ink-3">{duration(r)}</span>
            </Link>
          ))}
        </div>
      )}
    </HubCard>
  );
}
