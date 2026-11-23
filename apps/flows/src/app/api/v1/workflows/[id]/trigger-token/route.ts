import { json, route, uuidParam, workspaceOf } from '@/lib/api';
import { presentWorkflow } from '@/lib/present';
import { rotateTriggerToken } from '@/lib/service';

// Issues a new public trigger URL; the old one stops working.
export const POST = route<{ id: string }>(async (req, auth, { id }) =>
  json(presentWorkflow(await rotateTriggerToken(workspaceOf(req, auth), uuidParam(id, 'Workflow')), req))
);
