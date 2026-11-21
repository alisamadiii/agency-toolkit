import { NextRequest, NextResponse } from 'next/server';

import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { activeCrawls, crawlClient } from '@/lib/checker/crawl';
import { findSite } from '@/lib/site-lookup';

// Starts a full check now. Fire-and-forget: the run shows up in /runs as
// "running" right away. skipped = a check for this site is already running.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ site: string }> }
) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const client = await findSite(user.id, decodeURIComponent((await params).site));
  if (!client) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

  if (activeCrawls().has(client.id)) return NextResponse.json({ started: false, skipped: true });

  void crawlClient(client).catch((error) =>
    console.error(`[api] manual crawl of ${client.baseUrl} failed`, error)
  );
  return NextResponse.json({ started: true, skipped: false }, { status: 202 });
}
