import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { runs } from '@/db/schema';

import { requireOwnedClient } from '../_load';
import { HistoryView } from '../_components/history-view';

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireOwnedClient(id);

  const runRows = await db
    .select()
    .from(runs)
    .where(eq(runs.clientId, id))
    .orderBy(desc(runs.startedAt))
    .limit(20);

  return (
    <HistoryView
      runs={runRows.map((r) => ({
        id: r.id,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        pagesChecked: r.pagesChecked,
        pagesTotal: r.pagesTotal,
        errorCount: r.errorCount,
        warningCount: r.warningCount,
      }))}
    />
  );
}
