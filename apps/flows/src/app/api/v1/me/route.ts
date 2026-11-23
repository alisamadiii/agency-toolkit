import { json, route } from '@/lib/api';
import { getWorkspace, publicWorkspace } from '@/lib/service';

export const GET = route(async (_req, auth) =>
  json({
    admin: auth.admin,
    workspace: auth.workspaceId ? publicWorkspace(await getWorkspace(auth.workspaceId)) : null,
  })
);
