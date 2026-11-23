import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { integration, type IntegrationProvider } from '@/db/schema';

import { googleCalendarActions, listCalendars } from './google-calendar';
import { accessTokenFor, getIntegration, IntegrationError, publicIntegration } from './oauth';
import { findAction, PROVIDERS, type ProviderId } from './registry';

const RUNNERS: Record<ProviderId, Record<string, typeof googleCalendarActions[string]>> = {
  google_calendar: googleCalendarActions,
};

// Runs one app action with the workspace's own connection (looked up by workspace id,
// never by anything in the workflow JSON).
export async function runIntegrationAction(opts: {
  workspaceId: string;
  provider: string;
  action: string;
  params: Record<string, string>;
  idempotencyKey: string;
}) {
  const spec = findAction(opts.provider, opts.action);
  const runner = RUNNERS[opts.provider as ProviderId]?.[opts.action];
  if (!spec || !runner) throw new IntegrationError(`Unknown action ${opts.provider}.${opts.action}`);
  for (const f of spec.fields) {
    if (f.required && !opts.params[f.key]?.trim()) throw new IntegrationError(`"${f.label}" is required`);
  }
  const row = await getIntegration(opts.workspaceId, opts.provider as IntegrationProvider);
  if (!row) {
    throw new IntegrationError(`${PROVIDERS[opts.provider as ProviderId].label} isn't connected. Connect it in Automations → Integrations.`);
  }
  const token = await accessTokenFor(row);
  return runner({ token, settings: row.settings, params: opts.params, idempotencyKey: opts.idempotencyKey });
}

export async function calendarsFor(workspaceId: string) {
  const row = await getIntegration(workspaceId, 'google_calendar');
  if (!row) throw new IntegrationError('Google Calendar is not connected');
  return listCalendars(await accessTokenFor(row));
}

export { IntegrationError };

// Status for every provider in this workspace (never tokens).
export async function integrationStatus(workspaceId: string) {
  const rows = await db.select().from(integration).where(eq(integration.workspaceId, workspaceId));
  return (Object.keys(PROVIDERS) as ProviderId[]).map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return { provider, label: PROVIDERS[provider].label, connected: Boolean(row), ...(row ? publicIntegration(row) : {}) };
  });
}
