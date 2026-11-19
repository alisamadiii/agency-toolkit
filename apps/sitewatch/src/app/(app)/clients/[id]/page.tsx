import { and, asc, eq, desc, gte } from 'drizzle-orm';

import { db } from '@/db';
import { incidents, uptimeChecks } from '@/db/schema';

import { requireOwnedClient, endpointStatuses } from './_load';
import { UptimeDashboard } from './uptime-dashboard';

type Ping = { checkedAt: Date; ok: boolean; status: number | null; responseMs: number | null };

// Uptime % = share of successful pings in the window. null when no data yet.
function uptimePct(pings: Ping[], sinceMs: number): number | null {
  const window = pings.filter((p) => p.checkedAt.getTime() >= sinceMs);
  if (window.length === 0) return null;
  const ok = window.filter((p) => p.ok).length;
  return (ok / window.length) * 100;
}

// Bucket the last 24h of pings into fixed slots for the status strip. A slot is
// "down" if any ping in it failed, "up" if all succeeded, null if no data.
function buildBar(pings: Ping[], slots: number, spanMs: number) {
  const now = Date.now();
  const start = now - spanMs;
  const size = spanMs / slots;
  const bar: { state: 'up' | 'down' | 'none'; from: number }[] = [];
  for (let i = 0; i < slots; i++) {
    const from = start + i * size;
    const inSlot = pings.filter(
      (p) => p.checkedAt.getTime() >= from && p.checkedAt.getTime() < from + size
    );
    const state = inSlot.length === 0 ? 'none' : inSlot.some((p) => !p.ok) ? 'down' : 'up';
    bar.push({ state, from });
  }
  return bar;
}

// Hourly average response time over the window, for the chart. Skips empty hours.
function responseSeries(pings: Ping[], sinceMs: number) {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const p of pings) {
    if (p.checkedAt.getTime() < sinceMs || p.responseMs == null || !p.ok) continue;
    const hour = Math.floor(p.checkedAt.getTime() / 3_600_000) * 3_600_000;
    const b = buckets.get(hour) ?? { sum: 0, n: 0 };
    b.sum += p.responseMs;
    b.n += 1;
    buckets.set(hour, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, b]) => ({ t: hour, ms: Math.round(b.sum / b.n) }));
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await requireOwnedClient(id);

  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [pingRows, uptimeIncidentRows, endpoints] = await Promise.all([
    db
      .select({
        checkedAt: uptimeChecks.checkedAt,
        ok: uptimeChecks.ok,
        status: uptimeChecks.status,
        responseMs: uptimeChecks.responseMs,
      })
      .from(uptimeChecks)
      .where(and(eq(uptimeChecks.clientId, id), gte(uptimeChecks.checkedAt, since30d)))
      .orderBy(asc(uptimeChecks.checkedAt)),
    // Downtime history: uptime incidents (open + resolved), newest first.
    db
      .select()
      .from(incidents)
      .where(and(eq(incidents.clientId, id), eq(incidents.checkType, 'uptime')))
      .orderBy(desc(incidents.firstSeenAt))
      .limit(15),
    endpointStatuses(id, client.endpointChecks),
  ]);

  const pings: Ping[] = pingRows;
  const now = Date.now();

  // "Up since" / "down since": an open uptime incident means currently down
  // (since its firstSeenAt); otherwise up since the last recovery, falling back
  // to the client's creation time.
  const openUptime = uptimeIncidentRows.find((i) => i.resolvedAt === null);
  const lastResolved = uptimeIncidentRows.find((i) => i.resolvedAt !== null);
  const downSince = openUptime ? openUptime.firstSeenAt.toISOString() : null;
  const upSince = openUptime
    ? null
    : (lastResolved?.resolvedAt ?? client.createdAt).toISOString();

  const uptime = {
    pct24h: uptimePct(pings, now - 86_400_000),
    pct7d: uptimePct(pings, now - 7 * 86_400_000),
    pct30d: uptimePct(pings, now - 30 * 86_400_000),
    avgResponseMs: (() => {
      const vals = pings.filter((p) => p.ok && p.responseMs != null).map((p) => p.responseMs!);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    })(),
    bar24h: buildBar(pings, 48, 86_400_000),
    series: responseSeries(pings, now - 30 * 86_400_000),
    upSince,
    downSince,
    lastCheckAt: client.lastUptimeAt?.toISOString() ?? null,
    incidents: uptimeIncidentRows.map((i) => ({
      id: i.id,
      message: i.message,
      firstSeenAt: i.firstSeenAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    })),
  };

  return (
    <UptimeDashboard
      status={client.uptimeStatus}
      sslValidTo={client.sslValidTo?.toISOString() ?? null}
      domainExpiry={client.domainExpiry?.toISOString() ?? null}
      uptime={uptime}
      endpoints={endpoints.map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        method: e.method,
        status: e.status,
        downReason: e.downReason,
      }))}
    />
  );
}
