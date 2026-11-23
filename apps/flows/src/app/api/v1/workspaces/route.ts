import { body, json, route } from '@/lib/api';
import { workspaceCreateSchema } from '@/lib/schemas';
import { createWorkspace, listWorkspaces, publicWorkspace } from '@/lib/service';

export const GET = route(async () => json({ data: (await listWorkspaces()).map(publicWorkspace) }), { admin: true });

export const POST = route(
  async (req) => json(publicWorkspace(await createWorkspace(await body(req, workspaceCreateSchema))), 201),
  { admin: true }
);
