import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { RunDetail } from '@/components/run-detail';
import { db } from '@/db';
import { run, workflow } from '@/db/schema';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

export default async function RunPage({ params }: PageProps<'/runs/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [ref] = await db.select({ workspaceId: run.workspaceId }).from(run).where(eq(run.id, id));
  if (!ref) notFound();
  const r = await service.getRun(ref.workspaceId, id);
  const [wf] = await db.select({ name: workflow.name }).from(workflow).where(eq(workflow.id, r.workflowId));
  const ws = await service.getWorkspace(r.workspaceId);
  return (
    <RunDetail
      r={r}
      workflowName={wf?.name ?? 'Workflow'}
      workspaceName={ws.name}
      backHref={`/w/${r.workspaceId}/workflows/${r.workflowId}`}
      canCancel
    />
  );
}
