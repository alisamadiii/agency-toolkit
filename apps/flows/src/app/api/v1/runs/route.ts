import { ApiError, json, route, workspaceOf } from '@/lib/api';
import { RUN_STATUSES, type RunStatus } from '@/db/schema';
import { listRuns } from '@/lib/service';

// ?workflowId=&status=&limit=&cursor=<nextCursor from the previous page>
export const GET = route(async (req, auth) => {
  const q = req.nextUrl.searchParams;
  const status = q.get('status') ?? undefined;
  if (status && !RUN_STATUSES.includes(status as RunStatus)) throw new ApiError(400, `status must be one of ${RUN_STATUSES.join(', ')}`);
  const cursor = q.get('cursor');
  const before = cursor ? new Date(cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) throw new ApiError(400, 'Invalid cursor');
  return json(
    await listRuns(workspaceOf(req, auth), {
      workflowId: q.get('workflowId') ?? undefined,
      status: status as RunStatus | undefined,
      before,
      limit: Number(q.get('limit')) || undefined,
    })
  );
});
