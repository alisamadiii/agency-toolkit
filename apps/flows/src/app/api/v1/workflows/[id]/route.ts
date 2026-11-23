import { body, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { presentWorkflow } from '@/lib/present';
import { workflowUpdateSchema } from '@/lib/schemas';
import { deleteWorkflow, getWorkflow, updateWorkflow } from '@/lib/service';

type P = { id: string };

export const GET = route<P>(async (req, auth, { id }) =>
  json(presentWorkflow(await getWorkflow(workspaceOf(req, auth), uuidParam(id, 'Workflow')), req))
);

export const PATCH = route<P>(async (req, auth, { id }) => {
  const wf = await updateWorkflow(workspaceOf(req, auth), uuidParam(id, 'Workflow'), await body(req, workflowUpdateSchema));
  return json(presentWorkflow(wf, req));
});

export const DELETE = route<P>(async (req, auth, { id }) => {
  await deleteWorkflow(workspaceOf(req, auth), uuidParam(id, 'Workflow'));
  return new Response(null, { status: 204 });
});
