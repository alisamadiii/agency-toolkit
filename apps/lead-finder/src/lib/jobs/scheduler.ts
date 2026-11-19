import cron from 'node-cron';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { runs } from '@/db/schema';
import { zonedParts } from '@/lib/time';

import { isRunInProgress, runLeadFinder } from './lead-finder';
import { getSettings } from './settings';

declare global {
  var __lfScheduler: boolean | undefined;
}

// One tick: run once per local day, at or after the configured time. Reading
// settings every tick means schedule edits apply within a minute.
export async function sweep(now = new Date()) {
  const s = await getSettings();
  if (!s.enabled) return;

  const today = zonedParts(now, s.timezone);
  if (today.time < s.runTime) return;

  const [last] = await db
    .select({ startedAt: runs.startedAt })
    .from(runs)
    .where(and(eq(runs.trigger, 'scheduled')))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  // Failed runs count too, so a broken config doesn't retry every minute.
  if (last && zonedParts(last.startedAt, s.timezone).day === today.day) return;
  if (await isRunInProgress()) return;

  await runLeadFinder({ trigger: 'scheduled' });
}

export function startScheduler() {
  if (globalThis.__lfScheduler) return;
  globalThis.__lfScheduler = true;

  let busy = false;
  cron.schedule('* * * * *', async () => {
    if (busy) return;
    busy = true;
    try {
      await sweep();
    } catch (error) {
      console.error('[scheduler] sweep failed', error);
    } finally {
      busy = false;
    }
  });
  console.log('[scheduler] started');
}
