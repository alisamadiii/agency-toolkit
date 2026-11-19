import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { clients, runs } from '@/db/schema';
import { crawlClient } from '@/lib/checker/crawl';

// Daily full crawl of every enabled client. crawlClient contains its own
// error handling, so one broken site never blocks the rest. The executionId
// ties each site's run row back to this job execution.
export async function deepCrawlAll(executionId?: string): Promise<Record<string, unknown>> {
  const list = await db.select().from(clients).where(eq(clients.enabled, true));

  const perSite: {
    name: string;
    status: string;
    errorCount: number;
    warningCount: number;
  }[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const client of list) {
    const { runId, skipped } = await crawlClient(client, { jobExecutionId: executionId });
    if (skipped || !runId) {
      perSite.push({ name: client.name, status: 'skipped', errorCount: 0, warningCount: 0 });
      continue;
    }
    const [run] = await db
      .select({
        status: runs.status,
        errorCount: runs.errorCount,
        warningCount: runs.warningCount,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .orderBy(desc(runs.startedAt))
      .limit(1);
    perSite.push({
      name: client.name,
      status: run?.status ?? 'unknown',
      errorCount: run?.errorCount ?? 0,
      warningCount: run?.warningCount ?? 0,
    });
    totalErrors += run?.errorCount ?? 0;
    totalWarnings += run?.warningCount ?? 0;
  }

  return { sites: list.length, totalErrors, totalWarnings, perSite };
}
