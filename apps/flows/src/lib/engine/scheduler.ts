import { and, eq, lte, sql as dsql } from 'drizzle-orm';

import { db } from '@/db';
import { run, schedule, workflow } from '@/db/schema';
import { nextRun } from '@/lib/cron';

import { notifyWorkers } from './queue';

const TICK_MS = 15_000;

// Turns due schedules into queued runs. Safe with many instances: rows are locked with
// SKIP LOCKED and each (schedule, slot) can only be inserted once. Missed slots are not
// back-filled: after downtime a schedule fires once, then moves to its next future slot.
export async function tick() {
  let created = 0;
  await db.transaction(async (tx) => {
    const due = await tx
      .select({ schedule, workflow })
      .from(schedule)
      .innerJoin(workflow, eq(workflow.id, schedule.workflowId))
      .where(and(eq(schedule.enabled, true), lte(schedule.nextRunAt, dsql`now()`)))
      .limit(200)
      .for('update', { of: schedule, skipLocked: true });

    const now = new Date();
    for (const { schedule: s, workflow: wf } of due) {
      if (wf.enabled) {
        const inserted = await tx
          .insert(run)
          .values({
            workflowId: wf.id,
            workspaceId: wf.workspaceId,
            trigger: 'schedule',
            scheduleId: s.id,
            scheduleSlot: s.nextRunAt,
            input: s.input,
            graph: wf.graph,
            timeoutSec: wf.timeoutSec,
            maxAttempts: wf.maxAttempts,
            workflowVersion: wf.version,
          })
          .onConflictDoNothing()
          .returning({ id: run.id });
        created += inserted.length;
      }

      let next: Date;
      try {
        next = nextRun(s.cron, s.timezone, now);
      } catch {
        // Expression became invalid (e.g. timezone data); park it instead of looping.
        await tx.update(schedule).set({ enabled: false }).where(eq(schedule.id, s.id));
        continue;
      }
      await tx
        .update(schedule)
        .set({ nextRunAt: next, lastRunAt: wf.enabled ? s.nextRunAt : s.lastRunAt })
        .where(eq(schedule.id, s.id));
    }
  });
  if (created) await notifyWorkers();
  return created;
}

export function startScheduler() {
  const run = () => tick().catch((e) => console.error('[scheduler] tick failed', e));
  setInterval(run, TICK_MS);
  setTimeout(run, 2_000);
  console.log('[scheduler] started (15s tick)');
}
