import type { NextRequest } from 'next/server';

import type { workflow } from '@/db/schema';

// Public base URL for links handed to API clients.
export function baseUrl(req: NextRequest) {
  const configured = process.env.PUBLIC_URL?.replace(/\/$/, '');
  return configured || req.nextUrl.origin;
}

export function presentWorkflow(wf: typeof workflow.$inferSelect, req: NextRequest) {
  const { triggerToken, ...rest } = wf;
  return { ...rest, triggerUrl: `${baseUrl(req)}/api/hooks/${wf.id}/${triggerToken}` };
}
