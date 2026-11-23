import { body, json, route, uuidParam } from '@/lib/api';
import { workspaceUpdateSchema } from '@/lib/schemas';
import { deleteWorkspace, getWorkspace, publicWorkspace, updateWorkspace } from '@/lib/service';

type P = { id: string };

export const GET = route<P>(async (_req, _a, { id }) => json(publicWorkspace(await getWorkspace(uuidParam(id)))), {
  admin: true,
});

export const PATCH = route<P>(
  async (req, _a, { id }) =>
    json(publicWorkspace(await updateWorkspace(uuidParam(id), await body(req, workspaceUpdateSchema)))),
  { admin: true }
);

export const DELETE = route<P>(
  async (_req, _a, { id }) => {
    await deleteWorkspace(uuidParam(id));
    return new Response(null, { status: 204 });
  },
  { admin: true }
);
