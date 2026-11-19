import { notFound } from 'next/navigation';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';

import { db } from '@/db';
import { clients, incidents, runs, type EndpointCheck } from '@/db/schema';
import { requireSession } from '@/lib/session';

// Loads the client row the signed-in user owns, or 404s. Shared by the
// per-domain layout and every sub-page so each verifies ownership itself.
export async function requireOwnedClient(id: string) {
  const { user } = await requireSession();
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.userId, user.id)));
  if (!client) notFound();
  return client;
}

export type EndpointStatus = 'up' | 'down' | 'pending';
export type EndpointWithStatus = EndpointCheck & {
  status: EndpointStatus;
  downReason: string | null;
};

// Resolves each configured endpoint to up/down/pending. Down = an open,
// non-muted `endpoint` incident matching the endpoint's id; pending = the site
// hasn't finished a crawl yet. Shared by the Endpoints page and the Dashboard.
export async function endpointStatuses(
  clientId: string,
  checks: EndpointCheck[] | null
): Promise<EndpointWithStatus[]> {
  const list = checks ?? [];
  if (list.length === 0) return [];

  const [downIncidents, completedRun] = await Promise.all([
    db
      .select({ fingerprint: incidents.fingerprint, message: incidents.message })
      .from(incidents)
      .where(
        and(
          eq(incidents.clientId, clientId),
          eq(incidents.checkType, 'endpoint'),
          isNull(incidents.resolvedAt),
          isNull(incidents.ignoredAt)
        )
      ),
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.clientId, clientId), isNotNull(runs.finishedAt)))
      .limit(1),
  ]);

  // fingerprint looks like `endpoint|<url>|endpoint:<id>` → map id -> reason.
  const downById = new Map<string, string>();
  for (const i of downIncidents) {
    const last = i.fingerprint.split('|').pop() ?? '';
    if (last.startsWith('endpoint:')) downById.set(last.slice('endpoint:'.length), i.message);
  }
  const hasRun = completedRun.length > 0;

  return list.map((e) => ({
    ...e,
    status: downById.has(e.id) ? 'down' : hasRun ? 'up' : 'pending',
    downReason: downById.get(e.id) ?? null,
  }));
}
