import { rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { and, isNotNull, lt, ne } from 'drizzle-orm';

import { db } from '@/db';
import { incidents, jobExecutions, runs, uptimeChecks } from '@/db/schema';
import { screenshotsDir } from '@/lib/checker/crawl';

const UPTIME_KEEP_DAYS = 30;
const RUNS_KEEP_DAYS = 90;
const JOB_EXEC_KEEP_DAYS = 30;

export async function retention(): Promise<Record<string, unknown>> {
  const uptimeCutoff = daysAgo(UPTIME_KEEP_DAYS);
  const runsCutoff = daysAgo(RUNS_KEEP_DAYS);
  const jobExecCutoff = daysAgo(JOB_EXEC_KEEP_DAYS);

  const oldUptime = await db
    .delete(uptimeChecks)
    .where(lt(uptimeChecks.checkedAt, uptimeCutoff))
    .returning({ id: uptimeChecks.id });

  const oldRuns = await db
    .delete(runs)
    .where(lt(runs.startedAt, runsCutoff))
    .returning({ id: runs.id });

  const oldIncidents = await db
    .delete(incidents)
    .where(and(isNotNull(incidents.resolvedAt), lt(incidents.resolvedAt, runsCutoff)))
    .returning({ id: incidents.id });

  // Keep any running row even if old, so the scheduler's "minutes since last"
  // is never blinded; only finished executions are pruned.
  const oldJobExecs = await db
    .delete(jobExecutions)
    .where(and(lt(jobExecutions.startedAt, jobExecCutoff), ne(jobExecutions.status, 'running')))
    .returning({ id: jobExecutions.id });

  // Screenshot folders are keyed by run id; drop folders whose run is gone.
  let screenshotDirsRemoved = 0;
  try {
    const base = screenshotsDir();
    const cutoffMs = runsCutoff.getTime();
    for (const entry of await readdir(base)) {
      const dir = path.join(base, entry);
      const info = await stat(dir).catch(() => null);
      if (info?.isDirectory() && info.mtimeMs < cutoffMs) {
        await rm(dir, { recursive: true, force: true });
        screenshotDirsRemoved += 1;
      }
    }
  } catch {
    // screenshots dir may not exist yet
  }

  return {
    uptimeRowsDeleted: oldUptime.length,
    runsDeleted: oldRuns.length,
    incidentsDeleted: oldIncidents.length,
    jobExecutionsDeleted: oldJobExecs.length,
    screenshotDirsRemoved,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
