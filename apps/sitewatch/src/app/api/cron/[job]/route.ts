import { NextRequest, NextResponse } from 'next/server';

import { deepCrawlAll } from '@/lib/jobs/deep-crawl';
import { retention } from '@/lib/jobs/retention';
import { runTrackedJob } from '@/lib/jobs/run-job';
import { uptimePulse } from '@/lib/jobs/uptime-pulse';

const JOBS: Record<string, (executionId: string) => Promise<Record<string, unknown>>> = {
  'uptime-pulse': () => uptimePulse(),
  'deep-crawl': (executionId) => deepCrawlAll(executionId),
  retention: () => retention(),
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> }
) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { job } = await params;
  const fn = JOBS[job];
  if (!fn) {
    return NextResponse.json({ error: 'Unknown job' }, { status: 404 });
  }

  // Manual trigger always runs (no interval gate) and is recorded in history.
  const outcome = await runTrackedJob(job, fn, { trigger: 'manual' });
  return NextResponse.json(outcome);
}
