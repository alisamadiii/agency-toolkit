import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { clients, incidents, pages, runs } from '@/db/schema';

export type SiteSummary = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  uptimeStatus: 'unknown' | 'up' | 'down';
  pageCount: number;
  openErrors: number;
  openWarnings: number;
  lastRun: {
    id: string;
    status: string;
    startedAt: string;
    pagesChecked: number;
  } | null;
};

// One row per monitored site with its health at a glance. Shared by the
// dashboard home page and GET /api/v1/sites.
export async function summarizeSites(userId: string): Promise<SiteSummary[]> {
  const list = await db
    .select()
    .from(clients)
    .where(eq(clients.userId, userId))
    .orderBy(clients.createdAt);

  return Promise.all(
    list.map(async (client) => {
      const [[pageCount], [openErrors], [openWarnings], [lastRun]] =
        await Promise.all([
          db.select({ value: count() }).from(pages).where(eq(pages.clientId, client.id)),
          db
            .select({ value: count() })
            .from(incidents)
            .where(
              and(
                eq(incidents.clientId, client.id),
                isNull(incidents.resolvedAt),
                isNull(incidents.ignoredAt),
                eq(incidents.severity, 'error')
              )
            ),
          db
            .select({ value: count() })
            .from(incidents)
            .where(
              and(
                eq(incidents.clientId, client.id),
                isNull(incidents.resolvedAt),
                isNull(incidents.ignoredAt),
                eq(incidents.severity, 'warning')
              )
            ),
          db
            .select()
            .from(runs)
            .where(eq(runs.clientId, client.id))
            .orderBy(desc(runs.startedAt))
            .limit(1),
        ]);

      return {
        id: client.id,
        name: client.name,
        baseUrl: client.baseUrl,
        enabled: client.enabled,
        uptimeStatus: client.uptimeStatus,
        pageCount: pageCount.value,
        openErrors: openErrors.value,
        openWarnings: openWarnings.value,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt.toISOString(),
              pagesChecked: lastRun.pagesChecked,
            }
          : null,
      };
    })
  );
}
