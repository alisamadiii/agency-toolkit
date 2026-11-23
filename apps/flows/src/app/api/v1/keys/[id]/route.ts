import { json, route, uuidParam } from '@/lib/api';
import { revokeApiKey } from '@/lib/service';

export const DELETE = route<{ id: string }>(async (_req, _a, { id }) => json(await revokeApiKey(uuidParam(id))), {
  admin: true,
});
