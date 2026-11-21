import { NextRequest, NextResponse } from 'next/server';

import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { endpointStatuses } from '@/lib/endpoint-status';
import { findSite } from '@/lib/site-lookup';

// Configured endpoint checks with their current up/down/pending status.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ site: string }> }
) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const client = await findSite(user.id, decodeURIComponent((await params).site));
  if (!client) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

  const endpoints = await endpointStatuses(client.id, client.endpointChecks);
  return NextResponse.json({
    endpoints: endpoints.map((e) => ({
      id: e.id,
      name: e.name,
      url: e.url,
      method: e.method,
      status: e.status,
      downReason: e.downReason,
    })),
  });
}
