import { body, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { scheduleUpdateSchema } from '@/lib/schemas';
import { deleteSchedule, updateSchedule } from '@/lib/service';

type P = { id: string };

export const PATCH = route<P>(async (req, auth, { id }) =>
  json(await updateSchedule(workspaceOf(req, auth), uuidParam(id, 'Schedule'), await body(req, scheduleUpdateSchema)))
);

export const DELETE = route<P>(async (req, auth, { id }) => {
  await deleteSchedule(workspaceOf(req, auth), uuidParam(id, 'Schedule'));
  return new Response(null, { status: 204 });
});
