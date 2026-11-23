import { body, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { enqueueRun } from '@/lib/engine/queue';
import { runCreateSchema } from '@/lib/schemas';

export const POST = route<{ id: string }>(async (req, auth, { id }) => {
  const { input } = await body(req, runCreateSchema);
  const run = await enqueueRun({
    workflowId: uuidParam(id, 'Workflow'),
    workspaceId: workspaceOf(req, auth),
    trigger: 'api',
    input,
  });
  return json({ runId: run.id, status: run.status }, 202);
});
