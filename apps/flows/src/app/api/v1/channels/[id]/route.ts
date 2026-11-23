import { body, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { channelUpdateSchema } from '@/lib/schemas';
import { deleteChannel, getChannel, updateChannel } from '@/lib/service';

type P = { id: string };

export const GET = route<P>(async (req, auth, { id }) => json(await getChannel(workspaceOf(req, auth), uuidParam(id, 'Channel'))));

// Send masked secrets back unchanged (or leave them out) to keep the stored values.
export const PATCH = route<P>(async (req, auth, { id }) =>
  json(await updateChannel(workspaceOf(req, auth), uuidParam(id, 'Channel'), await body(req, channelUpdateSchema)))
);

export const DELETE = route<P>(async (req, auth, { id }) => {
  await deleteChannel(workspaceOf(req, auth), uuidParam(id, 'Channel'));
  return new Response(null, { status: 204 });
});
