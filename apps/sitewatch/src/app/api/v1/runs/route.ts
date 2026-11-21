import { and, desc, eq, type SQL } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { clients, runs } from '@/db/schema';
import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { findSite } from '@/lib/site-lookup';

export async function GET(request: NextRequest) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const site = request.nextUrl.searchParams.get('site');
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get('limit')) || 20,
    100
  );

  const filters: SQL[] = [eq(clients.userId, user.id)];
  if (site) {
    const client = await findSite(user.id, site);
    if (!client) return NextResponse.json({ runs: [] });
    filters.push(eq(clients.id, client.id));
  }

  const rows = await db
    .select({ run: runs, clientName: clients.name, clientBaseUrl: clients.baseUrl })
    .from(runs)
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(and(...filters))
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  return NextResponse.json({
    runs: rows.map(({ run, clientName, clientBaseUrl }) => ({
      id: run.id,
      site: { id: run.clientId, name: clientName, baseUrl: clientBaseUrl },
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      pagesChecked: run.pagesChecked,
      pagesTotal: run.pagesTotal,
      errorCount: run.errorCount,
      warningCount: run.warningCount,
    })),
  });
}
