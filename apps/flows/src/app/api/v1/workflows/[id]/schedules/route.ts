import { body, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { scheduleCreateSchema } from '@/lib/schemas';
import { createSchedule, listSchedules } from '@/lib/service';

type P = { id: string };

export const GET = route<P>(async (req, auth, { id }) =>
  json({ data: await listSchedules(workspaceOf(req, auth), uuidParam(id, 'Workflow')) })
);

export const POST = route<P>(async (req, auth, { id }) =>
  json(await createSchedule(workspaceOf(req, auth), uuidParam(id, 'Workflow'), await body(req, scheduleCreateSchema)), 201)
);
