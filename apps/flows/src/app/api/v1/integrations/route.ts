import { json, route, workspaceOf } from '@/lib/api';
import { integrationStatus } from '@/lib/integrations';

// This workspace's connected apps (account email and status only; never tokens).
export const GET = route(async (req, auth) => json({ data: await integrationStatus(workspaceOf(req, auth)) }));
