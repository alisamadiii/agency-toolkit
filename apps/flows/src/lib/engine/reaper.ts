import { sql } from '@/db';

const REAP_MS = 30_000;
const RETENTION_MS = 60 * 60_000;

// Runs whose worker died (lease expired) are retried or failed.
export async function reap() {
  await sql`
    UPDATE run SET
      status = CASE WHEN attempt < max_attempts THEN 'queued' ELSE 'failed' END,
      error = CASE WHEN attempt < max_attempts THEN error ELSE 'Worker stopped while running (lease expired)' END,
      finished_at = CASE WHEN attempt < max_attempts THEN NULL ELSE now() END,
      available_at = now(),
      locked_by = NULL,
      lease_until = NULL
    WHERE status = 'running' AND lease_until < now()`;
  // Leftover step rows of a lost run.
  await sql`
    UPDATE run_step SET status = 'failed', error = 'Worker stopped'
    WHERE status = 'running' AND run_id IN (SELECT id FROM run WHERE status <> 'running')`;
}

export async function retention() {
  const days = Math.max(1, Number(process.env.RUN_RETENTION_DAYS) || 30);
  await sql`DELETE FROM run WHERE finished_at < now() - make_interval(days => ${days})`;
}

export function startReaper() {
  setInterval(() => reap().catch((e) => console.error('[reaper] failed', e)), REAP_MS);
  setInterval(() => retention().catch((e) => console.error('[retention] failed', e)), RETENTION_MS);
  setTimeout(() => reap().catch(() => {}), 5_000);
}
