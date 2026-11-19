// Production entrypoint (Coolify). Long-running service: ticks every minute,
// runs the lead finder once a day at the time saved in dashboard settings, and
// serves GET /health for Coolify's healthcheck.
import 'dotenv/config';

import { createServer } from 'node:http';
import { desc } from 'drizzle-orm';

import { db } from '@/db';
import { runs } from '@/db/schema';
import { env } from '@/env';
import { startScheduler } from '@/lib/jobs/scheduler';
import { getSettings } from '@/lib/jobs/settings';
import { nextRunAt } from '@/lib/time';

env(); // fail fast on missing secrets
startScheduler();

const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }
  try {
    const s = await getSettings();
    const [last] = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(1);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        ok: true,
        enabled: s.enabled,
        nextRunAt: s.enabled ? nextRunAt(s.runTime, s.timezone).toISOString() : null,
        lastRun: last
          ? { status: last.status, startedAt: last.startedAt, newLeadsSaved: last.newLeadsSaved }
          : null,
      })
    );
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false }));
  }
}).listen(port, () => console.log(`[scheduler] health on :${port}/health`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[scheduler] ${signal}, exiting`);
    process.exit(0);
  });
}
