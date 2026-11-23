import { body, json, route, workspaceOf } from '@/lib/api';
import { presentWorkflow } from '@/lib/present';
import { workflowCreateSchema } from '@/lib/schemas';
import { createWorkflow, listWorkflows } from '@/lib/service';

export const GET = route(async (req, auth) =>
  json({ data: (await listWorkflows(workspaceOf(req, auth))).map((wf) => presentWorkflow(wf, req)) })
);

export const POST = route(async (req, auth) => {
  const wf = await createWorkflow(workspaceOf(req, auth), await body(req, workflowCreateSchema));
  return json(presentWorkflow(wf, req), 201);
});
