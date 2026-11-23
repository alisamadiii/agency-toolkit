import { ApiError, json, route, workspaceOf } from '@/lib/api';
import { disconnect } from '@/lib/integrations/oauth';
import { PROVIDER_IDS, type ProviderId } from '@/lib/integrations/registry';

// Disconnects and revokes the grant at the provider.
export const DELETE = route<{ provider: string }>(async (req, auth, { provider }) => {
  if (!PROVIDER_IDS.includes(provider as ProviderId)) throw new ApiError(404, 'Unknown integration');
  await disconnect(workspaceOf(req, auth), provider as ProviderId);
  return json({ disconnected: true });
});
