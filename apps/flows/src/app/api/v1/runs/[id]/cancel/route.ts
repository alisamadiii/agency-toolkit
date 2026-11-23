import { ApiError, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { cancelRun } from '@/lib/engine/queue';

export const POST = route<{ id: string }>(async (req, auth, { id }) => {
  const result = await cancelRun(uuidParam(id, 'Run'), workspaceOf(req, auth));
  if (!result) throw new ApiError(409, 'Run is not queued or running');
  return json({ status: result }, 202);
});
