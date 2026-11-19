import { desc } from 'drizzle-orm';

import { db } from '@/db';
import { jobExecutions } from '@/db/schema';
import { getSettings } from '@/lib/jobs/settings';
import { requireSession } from '@/lib/session';

import { JobsClient, type JobExecutionView } from './jobs-client';

export default async function JobsPage() {
  await requireSession();

  const [settings, execs] = await Promise.all([
    getSettings(),
    db.select().from(jobExecutions).orderBy(desc(jobExecutions.startedAt)).limit(50),
  ]);

  const executions: JobExecutionView[] = execs.map((e) => ({
    id: e.id,
    jobName: e.jobName,
    trigger: e.trigger,
    status: e.status,
    startedAt: e.startedAt.toISOString(),
    durationMs: e.durationMs,
    summary: summarize(e.jobName, e.result as Record<string, unknown> | null, e.error),
  }));

  return (
    <JobsClient
      schedule={{
        uptimePulseIntervalMinutes: settings.uptimePulseIntervalMinutes,
        deepCrawlIntervalHours: settings.deepCrawlIntervalHours,
      }}
      executions={executions}
    />
  );
}

function summarize(
  jobName: string,
  result: Record<string, unknown> | null,
  error: string | null
): string {
  if (error) return error.slice(0, 80);
  if (!result) return '—';
  if (jobName === 'deep-crawl') {
    return `${result.sites ?? 0} sites · ${result.totalErrors ?? 0} errors, ${result.totalWarnings ?? 0} warnings`;
  }
  if (jobName === 'uptime-pulse') {
    return `${result.up ?? 0} up · ${result.down ?? 0} down`;
  }
  if (jobName === 'retention') {
    const total =
      Number(result.uptimeRowsDeleted ?? 0) +
      Number(result.runsDeleted ?? 0) +
      Number(result.incidentsDeleted ?? 0) +
      Number(result.jobExecutionsDeleted ?? 0);
    return `cleaned ${total} rows`;
  }
  return '—';
}
