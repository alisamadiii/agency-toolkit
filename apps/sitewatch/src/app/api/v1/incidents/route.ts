import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { clients, incidents } from '@/db/schema';
import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { findSite } from '@/lib/site-lookup';

const DETAIL_NOISE_KEYS = ['fingerKey', 'runId', 'screenshot', 'box'];

export async function GET(request: NextRequest) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const site = request.nextUrl.searchParams.get('site');
  const includeResolved =
    request.nextUrl.searchParams.get('include_resolved') === '1';
  // Open problems including muted ones (ignoredAt tells them apart).
  const includeMuted = request.nextUrl.searchParams.get('include_muted') === '1';

  const filters: SQL[] = [eq(clients.userId, user.id)];
  if (!includeResolved) {
    filters.push(isNull(incidents.resolvedAt));
    if (!includeMuted) filters.push(isNull(incidents.ignoredAt));
  }
  if (site) {
    const client = await findSite(user.id, site);
    if (!client) return NextResponse.json({ incidents: [] });
    filters.push(eq(clients.id, client.id));
  }

  const rows = await db
    .select({ incident: incidents, clientName: clients.name, clientBaseUrl: clients.baseUrl })
    .from(incidents)
    .innerJoin(clients, eq(incidents.clientId, clients.id))
    .where(and(...filters))
    .orderBy(desc(incidents.firstSeenAt))
    .limit(500);

  return NextResponse.json({
    incidents: rows.map(({ incident, clientName, clientBaseUrl }) => ({
      id: incident.id,
      site: { id: incident.clientId, name: clientName, baseUrl: clientBaseUrl },
      checkType: incident.checkType,
      severity: incident.severity,
      message: incident.message,
      pageUrl: incident.pageUrl,
      details: cleanDetails(incident.details as Record<string, unknown> | null),
      firstSeenAt: incident.firstSeenAt.toISOString(),
      lastSeenAt: incident.lastSeenAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      ignoredAt: incident.ignoredAt?.toISOString() ?? null,
    })),
  });
}

function cleanDetails(details: Record<string, unknown> | null) {
  if (!details) return null;
  const out = Object.fromEntries(
    Object.entries(details).filter(([key]) => !DETAIL_NOISE_KEYS.includes(key))
  );
  return Object.keys(out).length > 0 ? out : null;
}

