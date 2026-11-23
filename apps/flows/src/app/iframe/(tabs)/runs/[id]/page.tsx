import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { RunDetail } from '@/components/run-detail';
import { db } from '@/db';
import { workflow } from '@/db/schema';
import { roleAtLeast } from '@/lib/embed';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

import { embedPage } from '../../../session';

export default async function IframeRun({ params }: PageProps<'/iframe/runs/[id]'>) {
  const { session, ws } = await embedPage();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // Scoped to the session's workspace: another workspace's run is simply not found.
  const r = await service.getRun(ws.id, id).catch(() => null);
  if (!r) notFound();
  const [wf] = await db
    .select({ name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.id, r.workflowId), eq(workflow.workspaceId, ws.id)));
  return (
    <RunDetail
      r={r}
      workflowName={wf?.name ?? 'Workflow'}
      workspaceName={ws.name}
      backHref={`/iframe/workflows/${r.workflowId}`}
      canCancel={roleAtLeast(session.role, 'content-editor')}
    />
  );
}
