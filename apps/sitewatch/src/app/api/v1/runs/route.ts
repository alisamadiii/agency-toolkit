import { and, desc, eq, type SQL } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { clients, runs } from '@/db/schema';
import { resolveApiUser, unauthorized } from '@/lib/api-key';

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
    const isUuid = /^[0-9a-f-]{36}$/i.test(site);
    filters.push(
      isUuid
        ? eq(clients.id, site)
        : eq(
            clients.baseUrl,
            /^https?:\/\//i.test(site)
              ? site.replace(/\/$/, '')
              : `https://${site.replace(/\/$/, '')}`
          )
    );
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
