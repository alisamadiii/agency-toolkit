import cron from 'node-cron';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { jobExecutions } from '@/db/schema';

import { deepCrawlAll } from './deep-crawl';
import { retention } from './retention';
import { runTrackedJob } from './run-job';
import { getSettings } from './settings';
import { uptimePulse } from './uptime-pulse';

declare global {
  var __wtScheduler: boolean | undefined;
}

const RETENTION_INTERVAL_HOURS = 24;

// Minutes since the last successful (or running) execution of a job, or
// Infinity if it has never run. "running" counts so a slow job isn't double-started.
async function minutesSinceLast(jobName: string): Promise<number> {
  const [last] = await db
    .select({ startedAt: jobExecutions.startedAt })
    .from(jobExecutions)
    .where(eq(jobExecutions.jobName, jobName))
    .orderBy(desc(jobExecutions.startedAt))
    .limit(1);
  if (!last) return Infinity;
  return (Date.now() - last.startedAt.getTime()) / 60_000;
}

// One tick: run each job whose configured interval has elapsed. Reading
// settings every tick means schedule edits take effect within a minute,
// with no node-cron reschedule.
export async function sweep() {
  const config = await getSettings();

  if ((await minutesSinceLast('uptime-pulse')) >= config.uptimePulseIntervalMinutes) {
    await runTrackedJob('uptime-pulse', () => uptimePulse()).catch((e) =>
      console.error('[scheduler] uptime-pulse failed', e)
    );
  }

  if ((await minutesSinceLast('deep-crawl')) >= config.deepCrawlIntervalHours * 60) {
    await runTrackedJob('deep-crawl', (execId) => deepCrawlAll(execId)).catch((e) =>
      console.error('[scheduler] deep-crawl failed', e)
    );
  }

  if ((await minutesSinceLast('retention')) >= RETENTION_INTERVAL_HOURS * 60) {
    await runTrackedJob('retention', () => retention()).catch((e) =>
      console.error('[scheduler] retention failed', e)
    );
  }
}

export function startScheduler() {
  if (globalThis.__wtScheduler) return;
  globalThis.__wtScheduler = true;

  // 1-minute heartbeat; the per-job interval gates decide what actually runs.
  cron.schedule('* * * * *', () => {
    sweep().catch((error) => console.error('[scheduler] sweep failed', error));
  });

  // Boot sweep so restarts never miss a due job; delayed so server + DB are up.
  setTimeout(() => {
    sweep().catch((error) =>
      console.error('[scheduler] boot sweep failed', error)
    );
  }, 10_000);

  console.log('[scheduler] started (1m heartbeat, interval-gated)');
}
