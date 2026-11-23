import { json, route, uuidParam, workspaceOf } from '@/lib/api';
import { getRun } from '@/lib/service';

export const GET = route<{ id: string }>(async (req, auth, { id }) =>
  json(await getRun(workspaceOf(req, auth), uuidParam(id, 'Run')))
);
