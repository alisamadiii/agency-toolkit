import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { and, eq } from 'drizzle-orm';

import { db, sql } from '@/db';
import { run } from '@/db/schema';

import { sendFinishWebhook, sendRunAlerts } from './finish';
import { RUN_CHANNEL } from './queue';
import { executeRun } from './run-workflow';

const LEASE_SECONDS = 60;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 5_000;

export const WORKER_ID = `${hostname()}-${randomUUID().slice(0, 8)}`;

// Claims the oldest due run, respecting each workspace's concurrency limit.
async function claim(): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    UPDATE run SET
      status = 'running',
      locked_by = ${WORKER_ID},
      lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
      attempt = attempt + 1,
      started_at = now()
    WHERE id = (
      SELECT r.id FROM run r
      JOIN workspace w ON w.id = r.workspace_id
      WHERE r.status = 'queued'
        AND r.available_at <= now()
        AND (SELECT count(*) FROM run x WHERE x.workspace_id = r.workspace_id AND x.status = 'running') < w.max_concurrent_runs
      ORDER BY r.available_at
      LIMIT 1
      FOR UPDATE OF r SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

async function processRun(runId: string) {
  const [row] = await db.select().from(run).where(eq(run.id, runId));
  if (!row) return;

  const controller = new AbortController();
  let stopReason: 'cancelled' | 'timeout' | null = null;
  const stop = (why: 'cancelled' | 'timeout') => {
    if (!stopReason) {
      stopReason = why;
      controller.abort();
    }
  };

  const runTimer = setTimeout(() => stop('timeout'), row.timeoutSec * 1000);
  // Renew the lease and pick up cancel requests.
  const heartbeat = setInterval(async () => {
    try {
      const [lease] = await sql<{ cancel_requested: boolean }[]>`
        UPDATE run SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
        WHERE id = ${runId} AND locked_by = ${WORKER_ID}
        RETURNING cancel_requested`;
      if (!lease) stop('cancelled'); // lease lost to the reaper
      else if (lease.cancel_requested) stop('cancelled');
    } catch (e) {
      console.error('[worker] heartbeat failed', e);
    }
  }, HEARTBEAT_MS);

  let outcome;
  try {
    outcome = await executeRun(row, controller.signal, () => stopReason);
  } catch (error) {
    outcome = { status: 'failed' as const, output: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(runTimer);
    clearInterval(heartbeat);
  }

  // Retry the whole run with back-off when attempts remain (not for cancels).
  const retry = (outcome.status === 'failed' || outcome.status === 'timeout') && row.attempt < row.maxAttempts;
  const [finished] = await db
    .update(run)
    .set(
      retry
        ? {
            status: 'queued',
            error: outcome.error,
            lockedBy: null,
            leaseUntil: null,
            availableAt: new Date(Date.now() + Math.min(30_000 * 2 ** (row.attempt - 1), 15 * 60_000)),
          }
        : {
            status: outcome.status,
            output: outcome.output,
            error: outcome.error,
            lockedBy: null,
            leaseUntil: null,
            finishedAt: new Date(),
          }
    )
    .where(and(eq(run.id, runId), eq(run.lockedBy, WORKER_ID)))
    .returning();

  if (finished && !retry) {
    await sendFinishWebhook(finished).catch((e) => console.error('[worker] finish webhook failed', e));
    await sendRunAlerts(finished).catch((e) => console.error('[worker] run alerts failed', e));
  }
}

let active = 0;
let wake: (() => void) | null = null;

function wakeUp() {
  wake?.();
}

async function loop(concurrency: number) {
  for (;;) {
    while (active < concurrency) {
      let id: string | null = null;
      try {
        id = await claim();
      } catch (e) {
        console.error('[worker] claim failed', e);
      }
      if (!id) break;
      active++;
      processRun(id)
        .catch((e) => console.error('[worker] run crashed', e))
        .finally(() => {
          active--;
          wakeUp();
        });
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_MS);
      wake = () => {
        clearTimeout(t);
        wake = null;
        resolve();
      };
    });
  }
}

export async function startWorker() {
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 4);
  await sql.listen(RUN_CHANNEL, () => wakeUp()).catch((e) => console.error('[worker] listen failed', e));
  void loop(concurrency);
  console.log(`[worker] ${WORKER_ID} started (concurrency ${concurrency})`);
}
