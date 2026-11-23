import { z } from 'zod';

import { body, json, route, uuidParam, workspaceOf } from '@/lib/api';
import { testChannel } from '@/lib/service';

// Sends "Test from Flows". Optional { "to": "..." } for email/SMS/WhatsApp/Telegram.
export const POST = route<{ id: string }>(async (req, auth, { id }) => {
  const { to } = await body(req, z.object({ to: z.string().max(1000).optional() }));
  return json(await testChannel(workspaceOf(req, auth), uuidParam(id, 'Channel'), to));
});
