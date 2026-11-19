import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { findings, pages, runs } from '@/db/schema';

import { requireOwnedClient } from '../_load';
import { PagesView } from '../_components/pages-view';

export default async function PagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireOwnedClient(id);

  const [pageRows, runRows] = await Promise.all([
    db.select().from(pages).where(eq(pages.clientId, id)).orderBy(pages.url),
    db
      .select()
      .from(runs)
      .where(eq(runs.clientId, id))
      .orderBy(desc(runs.startedAt))
      .limit(20),
  ]);

  // Per-page problem counts from the latest finished run.
  const latestFinished = runRows.find((r) => r.status !== 'running');
  const problemsByUrl = new Map<string, { errors: number; warnings: number }>();
  if (latestFinished) {
    const rows = await db
      .select({ pageUrl: findings.pageUrl, severity: findings.severity })
      .from(findings)
      .where(eq(findings.runId, latestFinished.id));
    for (const row of rows) {
      const entry = problemsByUrl.get(row.pageUrl) ?? { errors: 0, warnings: 0 };
      if (row.severity === 'error') entry.errors += 1;
      else entry.warnings += 1;
      problemsByUrl.set(row.pageUrl, entry);
    }
  }

  return (
    <PagesView
      pages={pageRows.map((p) => ({ url: p.url, problems: problemsByUrl.get(p.url) ?? null }))}
    />
  );
}
