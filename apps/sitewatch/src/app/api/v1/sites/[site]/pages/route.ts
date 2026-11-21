import { NextRequest, NextResponse } from 'next/server';

import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { pagesWithProblems } from '@/lib/page-problems';
import { findSite } from '@/lib/site-lookup';

// Every known page with error/warning counts from the latest finished run.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ site: string }> }
) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const client = await findSite(user.id, decodeURIComponent((await params).site));
  if (!client) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

  return NextResponse.json({ pages: await pagesWithProblems(client.id) });
}
