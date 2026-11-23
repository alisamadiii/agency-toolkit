import { json, route, workspaceOf } from '@/lib/api';
import { listSecrets } from '@/lib/service';

// Names only; values are write-only.
export const GET = route(async (req, auth) => json({ data: await listSecrets(workspaceOf(req, auth)) }));
