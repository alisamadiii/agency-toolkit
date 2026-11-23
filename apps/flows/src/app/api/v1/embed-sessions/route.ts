import { z } from 'zod';

import { EMBED_ROLES } from '@/db/schema';
import { body, json, route } from '@/lib/api';
import { createEmbedTicket } from '@/lib/embed';
import { baseUrl } from '@/lib/present';

const schema = z.object({
  // The client hub project id (uuid). Its workspace gets the same id.
  projectId: z.uuid(),
  projectName: z.string().min(1).max(200),
  user: z
    .object({ id: z.string().max(200).optional(), email: z.string().max(320).optional(), name: z.string().max(200).optional() })
    .default({}),
  role: z.enum(EMBED_ROLES),
});

// Admin only (the hub's server). Returns a one-time /iframe URL, valid for 60 seconds,
// that opens this project's workspace and nothing else.
export const POST = route(
  async (req) => {
    const input = await body(req, schema);
    const { ticket, workspaceId, expiresAt } = await createEmbedTicket(input);
    return json(
      { url: `${baseUrl(req)}/iframe/start?ticket=${encodeURIComponent(ticket)}`, workspaceId, expiresAt },
      201
    );
  },
  { admin: true }
);
