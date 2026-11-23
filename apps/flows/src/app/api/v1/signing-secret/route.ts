import { json, route, workspaceOf } from '@/lib/api';
import { decrypt } from '@/lib/crypto';
import { getWorkspace } from '@/lib/service';

// The secret that signs this workspace's finish callbacks (X-Flows-Signature).
export const GET = route(async (req, auth) => {
  const ws = await getWorkspace(workspaceOf(req, auth));
  return json({ signingSecret: decrypt(ws.signingSecret) });
});
