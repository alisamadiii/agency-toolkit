import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { clients, uptimeChecks } from '@/db/schema';
import { alertUptimeDown, alertUptimeRecovered } from '@/lib/checker/alerts';
import { openUptimeIncident, resolveUptimeIncident } from '@/lib/checker/incidents';
import { USER_AGENT } from '@/lib/checker/sitemap';

const TIMEOUT = 15_000;
// Two consecutive failures before a down alert — one blip never pages.
const FAIL_STREAK_TO_ALERT = 2;

export async function uptimePulse(): Promise<Record<string, unknown>> {
  const list = await db.select().from(clients).where(eq(clients.enabled, true));
  let up = 0;
  let down = 0;

  for (const client of list) {
    const probe = await probeOnce(client.baseUrl);
    await db.insert(uptimeChecks).values({
      clientId: client.id,
      ok: probe.ok,
      status: probe.status,
      responseMs: probe.responseMs,
      error: probe.error,
    });

    if (probe.ok) {
      up += 1;
      if (client.uptimeStatus === 'down') {
        const incident = await resolveUptimeIncident(client.id, client.baseUrl);
        await alertUptimeRecovered(client, incident?.firstSeenAt ?? null);
      }
      await db
        .update(clients)
        .set({ uptimeStatus: 'up', uptimeFailStreak: 0, lastUptimeAt: new Date() })
        .where(eq(clients.id, client.id));
    } else {
      down += 1;
      const streak = client.uptimeFailStreak + 1;
      const shouldAlert = streak >= FAIL_STREAK_TO_ALERT && client.uptimeStatus !== 'down';
      if (shouldAlert) {
        const incident = await openUptimeIncident(
          client.id,
          client.baseUrl,
          probe.error ?? `Site unreachable (HTTP ${probe.status ?? '—'})`
        );
        if (incident) await alertUptimeDown(client, incident);
      }
      await db
        .update(clients)
        .set({
          uptimeStatus: shouldAlert || client.uptimeStatus === 'down' ? 'down' : client.uptimeStatus,
          uptimeFailStreak: streak,
          lastUptimeAt: new Date(),
        })
        .where(eq(clients.id, client.id));
    }
  }

  return { clients: list.length, up, down };
}

async function probeOnce(baseUrl: string): Promise<{
  ok: boolean;
  status: number | null;
  responseMs: number;
  error: string | null;
}> {
  const started = Date.now();
  try {
    const res = await fetch(baseUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': USER_AGENT },
      cache: 'no-store',
    });
    return {
      ok: res.ok,
      status: res.status,
      responseMs: Date.now() - started,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      responseMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Unreachable',
    };
  }
}
