import { json, route, workspaceOf } from '@/lib/api';
import { listSchedules } from '@/lib/service';

export const GET = route(async (req, auth) => json({ data: await listSchedules(workspaceOf(req, auth)) }));
