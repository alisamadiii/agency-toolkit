import { body, json, route, workspaceOf } from '@/lib/api';
import { channelCreateSchema } from '@/lib/schemas';
import { createChannel, listChannels } from '@/lib/service';

// This workspace's notification channels. Secret fields come back masked.
export const GET = route(async (req, auth) => json({ data: await listChannels(workspaceOf(req, auth)) }));

export const POST = route(async (req, auth) =>
  json(await createChannel(workspaceOf(req, auth), await body(req, channelCreateSchema)), 201)
);
