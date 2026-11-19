import type { Client, Incident } from '@/db/schema';

import { sendAlert } from '@/lib/notifications/dispatch';
import type { AlertEmbed } from '@/lib/notifications/types';

import type { IncidentDelta } from './incidents';

type RunSummary = { pagesChecked: number; errorCount: number; warningCount: number };

const COLOR = { error: 0xef4444, warning: 0xf59e0b, ok: 0x22c55e } as const;

export async function alertIncidentDelta(
  client: Client,
  delta: IncidentDelta,
  summary: RunSummary
) {
  if (delta.opened.length === 0 && delta.resolved.length === 0) return;

  const errors = delta.opened.filter((i) => i.severity === 'error');
  const warnings = delta.opened.filter((i) => i.severity === 'warning');

  // --- text body (Slack / Telegram / email) ---
  const lines: string[] = [];
  if (errors.length > 0) {
    lines.push(`🔴 ${errors.length} new error${plural(errors.length)}:`);
    lines.push(...errors.slice(0, 10).map(formatIncident));
    if (errors.length > 10) lines.push(`…and ${errors.length - 10} more`);
  }
  if (warnings.length > 0) {
    lines.push(`🟡 ${warnings.length} new warning${plural(warnings.length)}:`);
    lines.push(...warnings.slice(0, 10).map(formatIncident));
    if (warnings.length > 10) lines.push(`…and ${warnings.length - 10} more`);
  }
  if (delta.resolved.length > 0) {
    lines.push(`🟢 ${delta.resolved.length} fixed:`);
    lines.push(...delta.resolved.slice(0, 10).map(formatIncident));
  }
  lines.push(
    `Checked ${summary.pagesChecked} pages — ${summary.errorCount} errors, ${summary.warningCount} warnings open.`
  );

  // --- Discord embed ---
  const fields: AlertEmbed['fields'] = [];
  if (errors.length > 0) {
    fields.push({ name: `🔴 Errors (${errors.length})`, value: bullets(errors) });
  }
  if (warnings.length > 0) {
    fields.push({ name: `🟡 Warnings (${warnings.length})`, value: bullets(warnings) });
  }
  if (delta.resolved.length > 0) {
    fields.push({ name: `🟢 Fixed (${delta.resolved.length})`, value: bullets(delta.resolved) });
  }

  const color =
    errors.length > 0 ? COLOR.error : warnings.length > 0 ? COLOR.warning : COLOR.ok;

  await sendAlert({
    title: `${client.name} — ${headline(delta)}`,
    lines,
    embed: {
      color,
      url: dashboardUrl(client.id),
      fields,
      footer: `Checked ${summary.pagesChecked} pages · ${summary.errorCount} errors, ${summary.warningCount} warnings open`,
      timestamp: new Date().toISOString(),
    },
    data: {
      event: 'problems_changed',
      site: { name: client.name, baseUrl: client.baseUrl },
      opened: delta.opened.map(incidentJson),
      resolved: delta.resolved.map(incidentJson),
      summary,
      timestamp: new Date().toISOString(),
    },
  });
}

export async function alertUptimeDown(client: Client, incident: Incident) {
  await sendAlert({
    title: `${client.name} is DOWN`,
    lines: [`🔴 ${client.name} is DOWN`, incident.message, client.baseUrl],
    embed: {
      color: COLOR.error,
      url: dashboardUrl(client.id),
      fields: [{ name: '🔴 Site unreachable', value: incident.message }],
      footer: client.baseUrl,
      timestamp: new Date().toISOString(),
    },
    data: {
      event: 'site_down',
      site: { name: client.name, baseUrl: client.baseUrl },
      opened: [incidentJson(incident)],
      resolved: [],
      timestamp: new Date().toISOString(),
    },
  });
}

export async function alertUptimeRecovered(client: Client, downSince: Date | null) {
  const mins = downSince ? Math.round((Date.now() - downSince.getTime()) / 60_000) : null;
  const downtime = mins !== null ? `Downtime: about ${mins} min` : 'Recovered';
  await sendAlert({
    title: `${client.name} is back up`,
    lines: [`🟢 ${client.name} is back up`, downtime, client.baseUrl],
    embed: {
      color: COLOR.ok,
      url: dashboardUrl(client.id),
      fields: [{ name: '🟢 Back online', value: downtime }],
      footer: client.baseUrl,
      timestamp: new Date().toISOString(),
    },
    data: {
      event: 'site_recovered',
      site: { name: client.name, baseUrl: client.baseUrl },
      downSince: downSince?.toISOString() ?? null,
      downtimeMinutes: mins,
      timestamp: new Date().toISOString(),
    },
  });
}

// Public URL of the dashboard. BETTER_AUTH_URL may be host-only (Coolify magic
// vars) — normalize to a full https URL; localhost fallback for dev.
export function appBaseUrl(): string {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return 'http://localhost:3000';
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw.replace(/:\d+$/, '')}`;
  return withScheme.replace(/\/+$/, '');
}

function dashboardUrl(clientId: string): string {
  return `${appBaseUrl()}/clients/${clientId}`;
}

function headline(delta: IncidentDelta): string {
  const errors = delta.opened.filter((i) => i.severity === 'error').length;
  const warnings = delta.opened.filter((i) => i.severity === 'warning').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} new error${plural(errors)}`);
  if (warnings > 0) parts.push(`${warnings} new warning${plural(warnings)}`);
  if (delta.resolved.length > 0) parts.push(`${delta.resolved.length} fixed`);
  return parts.join(', ') || 'status changed';
}

function bullets(items: Incident[]): string {
  const shown = items.slice(0, 10).map(formatIncident);
  if (items.length > 10) shown.push(`…and ${items.length - 10} more`);
  return shown.join('\n');
}

function incidentJson(i: Incident) {
  return {
    checkType: i.checkType,
    severity: i.severity,
    message: i.message,
    pageUrl: i.pageUrl,
    details: i.details ?? null,
    firstSeenAt: i.firstSeenAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
  };
}

function formatIncident(i: Incident): string {
  const where = pathOf(i.pageUrl);
  return `• [${i.checkType}] ${i.message}${where ? ` — ${where}` : ''}`;
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '' : u.pathname;
  } catch {
    return url;
  }
}
