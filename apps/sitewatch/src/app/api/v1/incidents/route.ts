import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { clients, incidents } from '@/db/schema';
import { resolveApiUser, unauthorized } from '@/lib/api-key';

const DETAIL_NOISE_KEYS = ['fingerKey', 'runId', 'screenshot', 'box'];

export async function GET(request: NextRequest) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const site = request.nextUrl.searchParams.get('site');
  const includeResolved =
    request.nextUrl.searchParams.get('include_resolved') === '1';

  const filters: SQL[] = [eq(clients.userId, user.id)];
  if (!includeResolved) {
    filters.push(isNull(incidents.resolvedAt));
    filters.push(isNull(incidents.ignoredAt));
  }
  if (site) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(site);
    filters.push(
      isUuid ? eq(clients.id, site) : eq(clients.baseUrl, normalizeSite(site))
    );
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

function normalizeSite(site: string): string {
  if (/^https?:\/\//i.test(site)) return site.replace(/\/$/, '');
  return `https://${site.replace(/\/$/, '')}`;
}
