import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { incidents } from '@/db/schema';

import { requireOwnedClient } from '../_load';
import { ProblemsView, type IncidentView } from '../_components/problems-view';

export default async function ProblemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await requireOwnedClient(id);

  const openIncidents = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.clientId, id), isNull(incidents.resolvedAt)))
    .orderBy(desc(incidents.firstSeenAt));

  const toView = (i: (typeof openIncidents)[number]): IncidentView => ({
    id: i.id,
    checkType: i.checkType,
    pageUrl: i.pageUrl,
    severity: i.severity,
    message: i.message,
    details: (i.details as Record<string, unknown> | null) ?? null,
    firstSeenAt: i.firstSeenAt.toISOString(),
    ignoredAt: i.ignoredAt?.toISOString() ?? null,
  });

  return (
    <ProblemsView
      site={{ name: client.name, baseUrl: client.baseUrl }}
      incidents={openIncidents.filter((i) => i.ignoredAt === null).map(toView)}
      ignoredIncidents={openIncidents.filter((i) => i.ignoredAt !== null).map(toView)}
    />
  );
}
