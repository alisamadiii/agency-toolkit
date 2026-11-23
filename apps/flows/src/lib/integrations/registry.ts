// Apps workflows can use (client-safe). The canvas palette, the node panel and
// GET /integrations are built from this. The connection itself lives in the client
// hub, which runs the actions (see ./hub.ts); adding an app = one entry here plus its
// routes in the hub's flowsService router.

export const PROVIDER_IDS = ['google_calendar'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ActionField = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
};

export type ProviderAction = {
  id: string;
  label: string;
  description: string;
  fields: ActionField[];
  // Paths under nodes.<id>.output shown in the variables helper.
  outputHints: { path: string; label: string }[];
};

export type ProviderSpec = {
  label: string;
  description: string;
  actions: ProviderAction[];
};

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  google_calendar: {
    label: 'Google Calendar',
    description: 'Book meetings, find open time and read your calendar.',
    actions: [
      {
        id: 'find_free_slots',
        label: 'Find free time',
        description: 'Open slots between your events during working hours.',
        fields: [
          { key: 'durationMinutes', label: 'Length (minutes)', kind: 'number', placeholder: '30' },
          { key: 'from', label: 'From', kind: 'text', placeholder: 'now', help: 'ISO date/time or "now". Default: now.' },
          { key: 'to', label: 'To', kind: 'text', placeholder: '+7 days', help: 'ISO date/time. Default: 7 days from the start.' },
          { key: 'dayStart', label: 'Workday starts', kind: 'text', placeholder: '09:00' },
          { key: 'dayEnd', label: 'Workday ends', kind: 'text', placeholder: '17:00' },
          { key: 'days', label: 'Days', kind: 'text', placeholder: 'mon,tue,wed,thu,fri' },
          { key: 'timezone', label: 'Time zone', kind: 'text', placeholder: 'America/New_York', help: 'Default: the calendar setting.' },
          { key: 'limit', label: 'Max slots', kind: 'number', placeholder: '10' },
          { key: 'calendarId', label: 'Calendar', kind: 'text', placeholder: 'primary', help: 'Calendar id from the client hub. Default: your main calendar.' },
        ],
        outputHints: [
          { path: 'first.start', label: 'first free start' },
          { path: 'first.end', label: 'first free end' },
          { path: 'slots', label: 'all slots' },
        ],
      },
      {
        id: 'create_event',
        label: 'Book a meeting',
        description: 'Create an event and invite the guest.',
        fields: [
          { key: 'title', label: 'Title', kind: 'text', required: true, placeholder: 'Call with {{input.name}}' },
          { key: 'start', label: 'Start', kind: 'text', required: true, placeholder: '{{nodes.find_free_slots_1.output.first.start}}', help: 'ISO date/time.' },
          { key: 'durationMinutes', label: 'Length (minutes)', kind: 'number', placeholder: '30' },
          { key: 'guestEmail', label: 'Guest email', kind: 'text', placeholder: '{{input.email}}' },
          { key: 'guestName', label: 'Guest name', kind: 'text', placeholder: '{{input.name}}' },
          { key: 'description', label: 'Description', kind: 'textarea' },
          { key: 'location', label: 'Location', kind: 'text', placeholder: 'Phone, address or meeting link' },
          { key: 'addMeet', label: 'Add Google Meet link', kind: 'boolean' },
          { key: 'notifyGuests', label: 'Email the guest an invite', kind: 'boolean' },
          { key: 'timezone', label: 'Time zone', kind: 'text', placeholder: 'America/New_York' },
          { key: 'calendarId', label: 'Calendar', kind: 'text', placeholder: 'primary', help: 'Calendar id from the client hub. Default: your main calendar.' },
        ],
        outputHints: [
          { path: 'link', label: 'event link' },
          { path: 'eventId', label: 'event id' },
          { path: 'start', label: 'start' },
          { path: 'meetLink', label: 'Meet link' },
        ],
      },
      {
        id: 'list_events',
        label: 'List events',
        description: 'Events in a date range.',
        fields: [
          { key: 'from', label: 'From', kind: 'text', placeholder: 'now' },
          { key: 'to', label: 'To', kind: 'text', placeholder: '+7 days', help: 'Up to 62 days.' },
          { key: 'calendarId', label: 'Calendar', kind: 'text', placeholder: 'primary', help: 'Calendar id from the client hub. Default: your main calendar.' },
        ],
        outputHints: [
          { path: 'events', label: 'events' },
          { path: 'count', label: 'count' },
        ],
      },
      {
        id: 'cancel_event',
        label: 'Cancel a meeting',
        description: 'Delete an event, optionally telling the guests.',
        fields: [
          { key: 'eventId', label: 'Event id', kind: 'text', required: true, placeholder: '{{input.eventId}}' },
          { key: 'notifyGuests', label: 'Email the guests', kind: 'boolean' },
          { key: 'calendarId', label: 'Calendar', kind: 'text', placeholder: 'primary', help: 'Calendar id from the client hub. Default: your main calendar.' },
        ],
        outputHints: [{ path: 'cancelled', label: 'cancelled' }],
      },
    ],
  },
};

export function findAction(provider: string, action: string): ProviderAction | null {
  const spec = PROVIDERS[provider as ProviderId];
  return spec?.actions.find((a) => a.id === action) ?? null;
}
