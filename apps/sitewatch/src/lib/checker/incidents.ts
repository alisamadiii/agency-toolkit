import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { incidents, type Incident } from '@/db/schema';

import { fingerprintOf, type FindingInput } from './types';

export type IncidentDelta = {
  opened: Incident[];
  resolved: Incident[];
};

// Diffs a run's findings against open incidents: new fingerprints open an
// incident, missing ones resolve. Alerts fire only on these transitions.
export async function reconcileIncidents(
  clientId: string,
  findings: FindingInput[]
): Promise<IncidentDelta> {
  const open = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.clientId, clientId), isNull(incidents.resolvedAt)));

  // Fingerprints the user has muted. Sticky across flaps: a reopened problem
  // with a muted fingerprint is recorded but never alerts.
  const ignoredRows = await db
    .select({ fingerprint: incidents.fingerprint })
    .from(incidents)
    .where(and(eq(incidents.clientId, clientId), isNotNull(incidents.ignoredAt)));
  const ignoredFps = new Set(ignoredRows.map((r) => r.fingerprint));

  const now = new Date();
  const seen = new Map(findings.map((f) => [fingerprintOf(f), f]));
  const openByFp = new Map(open.map((i) => [i.fingerprint, i]));

  const opened: Incident[] = [];
  for (const [fp, finding] of seen) {
    // Uptime incidents are managed by the pulse job, not the crawler.
    if (finding.checkType === 'uptime') continue;
    const existing = openByFp.get(fp);
    if (existing) {
      // details refreshed too — the latest run's screenshot/selector wins.
      await db
        .update(incidents)
        .set({ lastSeenAt: now, details: finding.details ?? null })
        .where(eq(incidents.id, existing.id));
    } else {
      const muted = ignoredFps.has(fp);
      const [row] = await db
        .insert(incidents)
        .values({
          clientId,
          fingerprint: fp,
          checkType: finding.checkType,
          pageUrl: finding.pageUrl,
          severity: finding.severity,
          message: finding.message,
          details: finding.details ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          alertedAt: now,
          ignoredAt: muted ? now : null,
        })
        .returning();
      // Muted problems are recorded but never alert on (re)open.
      if (!muted) opened.push(row);
    }
  }

  const resolved: Incident[] = [];
  for (const incident of open) {
    if (incident.checkType === 'uptime') continue;
    if (!seen.has(incident.fingerprint)) {
      const [row] = await db
        .update(incidents)
        .set({ resolvedAt: now })
        .where(eq(incidents.id, incident.id))
        .returning();
      // No "fixed" alert for a muted problem.
      if (!incident.ignoredAt) resolved.push(row);
    }
  }

  return { opened, resolved };
}

export async function openUptimeIncident(clientId: string, baseUrl: string, message: string) {
  const fp = `uptime|${baseUrl}|down`;
  // Muted by the user — don't reopen or page.
  const [muted] = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(
      and(eq(incidents.clientId, clientId), eq(incidents.fingerprint, fp), isNotNull(incidents.ignoredAt))
    );
  if (muted) return null;
  const [existing] = await db
    .select()
    .from(incidents)
    .where(
      and(eq(incidents.clientId, clientId), eq(incidents.fingerprint, fp), isNull(incidents.resolvedAt))
    );
  if (existing) return null;
  const now = new Date();
  const [row] = await db
    .insert(incidents)
    .values({
      clientId,
      fingerprint: fp,
      checkType: 'uptime',
      pageUrl: baseUrl,
      severity: 'error',
      message,
      firstSeenAt: now,
      lastSeenAt: now,
      alertedAt: now,
    })
    .returning();
  return row;
}

export async function resolveUptimeIncident(clientId: string, baseUrl: string) {
  const fp = `uptime|${baseUrl}|down`;
  const [row] = await db
    .update(incidents)
    .set({ resolvedAt: new Date() })
    .where(
      and(eq(incidents.clientId, clientId), eq(incidents.fingerprint, fp), isNull(incidents.resolvedAt))
    )
    .returning();
  return row ?? null;
}
