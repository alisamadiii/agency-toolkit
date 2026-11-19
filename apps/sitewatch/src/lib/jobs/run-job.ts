import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { jobExecutions } from '@/db/schema';

type JobResult = Record<string, unknown>;
type Trigger = 'scheduled' | 'manual';

export type TrackedRun = {
  executionId: string;
  result?: JobResult;
  error?: string;
};

// Records every job run in job_executions (the Jobs page reads this), passing
// the execution id to the job so it can tag the rows it creates.
export async function runTrackedJob(
  name: string,
  fn: (executionId: string) => Promise<JobResult>,
  opts: { trigger?: Trigger } = {}
): Promise<TrackedRun> {
  const startedAt = new Date();
  const [exec] = await db
    .insert(jobExecutions)
    .values({ jobName: name, trigger: opts.trigger ?? 'scheduled', status: 'running', startedAt })
    .returning({ id: jobExecutions.id });

  try {
    const result = await fn(exec.id);
    await db
      .update(jobExecutions)
      .set({
        status: 'ok',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        result,
      })
      .where(eq(jobExecutions.id, exec.id));
    return { executionId: exec.id, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(jobExecutions)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: message,
      })
      .where(eq(jobExecutions.id, exec.id));
    return { executionId: exec.id, error: message };
  }
}
