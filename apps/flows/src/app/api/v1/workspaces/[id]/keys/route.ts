import { body, json, route, uuidParam } from '@/lib/api';
import { apiKeyCreateSchema } from '@/lib/schemas';
import { createApiKey, listApiKeys } from '@/lib/service';

type P = { id: string };

export const GET = route<P>(async (_req, _a, { id }) => json({ data: await listApiKeys(uuidParam(id)) }), {
  admin: true,
});

// The full key is in the response once; store it in the client hub.
export const POST = route<P>(
  async (req, _a, { id }) => json(await createApiKey(uuidParam(id), (await body(req, apiKeyCreateSchema)).name), 201),
  { admin: true }
);
