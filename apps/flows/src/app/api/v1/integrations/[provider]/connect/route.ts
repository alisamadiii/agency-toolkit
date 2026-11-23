import { ApiError, json, route, workspaceOf } from '@/lib/api';
import { googleConfigured, startConnect } from '@/lib/integrations/oauth';
import { PROVIDER_IDS, type ProviderId } from '@/lib/integrations/registry';

// A sign-in URL (valid 10 minutes, single use) to open in a browser window.
export const POST = route<{ provider: string }>(async (req, auth, { provider }) => {
  if (!PROVIDER_IDS.includes(provider as ProviderId)) throw new ApiError(404, 'Unknown integration');
  if (!googleConfigured()) throw new ApiError(503, 'Google sign-in is not set up on this server');
  return json({ url: await startConnect(workspaceOf(req, auth), provider as ProviderId) });
});
