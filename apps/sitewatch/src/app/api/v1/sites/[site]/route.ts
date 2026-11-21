import { NextRequest, NextResponse } from 'next/server';

import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { getSettings } from '@/lib/jobs/settings';
import { findSite } from '@/lib/site-lookup';
import { uptimeStats } from '@/lib/uptime-stats';

// One site's dashboard: status, SSL/domain expiry and 30 days of uptime stats.
// [site] = site id or domain (www-insensitive).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ site: string }> }
) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const client = await findSite(user.id, decodeURIComponent((await params).site));
  if (!client) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

  const [uptime, settings] = await Promise.all([uptimeStats(client), getSettings()]);

  return NextResponse.json({
    site: {
      id: client.id,
      name: client.name,
      baseUrl: client.baseUrl,
      enabled: client.enabled,
      uptimeStatus: client.uptimeStatus,
      pingEveryMinutes: settings.uptimePulseIntervalMinutes,
      sslValidTo: client.sslValidTo?.toISOString() ?? null,
      domainExpiry: client.domainExpiry?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
    },
    uptime,
  });
}
