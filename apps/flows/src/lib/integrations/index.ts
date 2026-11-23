import { hubCall, hubConfigured, IntegrationError } from './hub';
import { findAction, PROVIDERS, type ProviderId } from './registry';

// App actions run in the client hub (it owns the Google connection); Flows only
// sends the workspace id (= hub project id), the rendered params and a key that
// makes retries safe.
const HUB_PROCEDURES: Record<ProviderId, Record<string, string>> = {
  google_calendar: {
    find_free_slots: 'findFreeSlots',
    create_event: 'createEvent',
    list_events: 'listEvents',
    cancel_event: 'cancelEvent',
  },
};

// Runs one app action for this workspace (looked up by workspace id, never by
// anything in the workflow JSON).
export async function runIntegrationAction(opts: {
  workspaceId: string;
  provider: string;
  action: string;
  params: Record<string, string>;
  idempotencyKey: string;
}) {
  const spec = findAction(opts.provider, opts.action);
  const procedure = HUB_PROCEDURES[opts.provider as ProviderId]?.[opts.action];
  if (!spec || !procedure) throw new IntegrationError(`Unknown action ${opts.provider}.${opts.action}`);
  for (const f of spec.fields) {
    if (f.required && !opts.params[f.key]?.trim()) throw new IntegrationError(`"${f.label}" is required`);
  }
  return hubCall(procedure, { projectId: opts.workspaceId, params: opts.params, idempotencyKey: opts.idempotencyKey });
}

export { IntegrationError };

export type IntegrationCalendar = { id: string; name: string; primary: boolean; timeZone: string | null };

export type IntegrationStatus = {
  provider: ProviderId;
  label: string;
  connected: boolean;
  accountEmail?: string;
  // Why it isn't usable yet, in plain words.
  reason?: string;
  calendars?: IntegrationCalendar[];
};

type HubCalendarStatus = { connected: boolean; reason: string | null; email: string | null; calendars: IntegrationCalendar[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Status for every provider in this workspace, from the client hub (never tokens).
export async function integrationStatus(workspaceId: string): Promise<IntegrationStatus[]> {
  const label = PROVIDERS.google_calendar.label;
  const off = (reason: string): IntegrationStatus[] => [{ provider: 'google_calendar', label, connected: false, reason }];
  if (!hubConfigured()) return off('The client hub connection is not set up on this server (HUB_API_URL, HUB_API_KEY).');
  // Only workspaces opened from the client hub have a project behind them.
  if (!UUID.test(workspaceId)) return off('Available in workspaces opened from the client hub.');
  try {
    const s = await hubCall<HubCalendarStatus>('calendarStatus', { projectId: workspaceId }, 'query');
    return [
      {
        provider: 'google_calendar',
        label,
        connected: s.connected,
        accountEmail: s.email ?? undefined,
        reason: s.reason ?? undefined,
        calendars: s.calendars,
      },
    ];
  } catch (error) {
    return off(error instanceof Error ? error.message : 'Could not reach the client hub.');
  }
}
