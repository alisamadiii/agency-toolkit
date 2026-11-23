import { z } from 'zod';

// Notification channel types. Client-safe: the dashboard and GET /channel-types render
// their forms from `fields`; the server validates with `schema`.

export const CHANNEL_TYPES = [
  'slack',
  'discord',
  'telegram',
  'email',
  'sms',
  'whatsapp',
  'teams',
  'googlechat',
  'ntfy',
  'webhook',
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export type ChannelField = {
  key: string;
  label: string;
  kind: 'text' | 'password' | 'number' | 'select' | 'textarea';
  required?: boolean;
  // Never returned by the API; shown as SECRET_MASK.
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
};

export type ChannelSpec = {
  label: string;
  description: string;
  fields: ChannelField[];
  // How the recipient works for this type, or null when the channel itself is the destination.
  recipient: null | { label: string; placeholder: string; help: string; defaultKey: string };
  schema: z.ZodType;
};

export const SECRET_MASK = '••••••••';

const url = z.url();
const str = z.string().trim();

export const CHANNELS: Record<ChannelType, ChannelSpec> = {
  slack: {
    label: 'Slack',
    description: 'Post to a Slack channel through an incoming webhook.',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://hooks.slack.com/services/…',
        help: 'Slack → Apps → Incoming Webhooks → Add to channel.',
      },
    ],
    recipient: null,
    schema: z.object({ webhookUrl: url }),
  },
  discord: {
    label: 'Discord',
    description: 'Post to a Discord channel through a webhook.',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://discord.com/api/webhooks/…',
        help: 'Channel settings → Integrations → Webhooks → New webhook.',
      },
      { key: 'username', label: 'Bot name', kind: 'text', placeholder: 'Flows' },
      { key: 'avatarUrl', label: 'Avatar URL', kind: 'text', placeholder: 'https://…/logo.png' },
    ],
    recipient: null,
    schema: z.object({ webhookUrl: url, username: str.default(''), avatarUrl: str.default('') }),
  },
  telegram: {
    label: 'Telegram',
    description: 'Message a chat or group through a Telegram bot.',
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: '123456:ABC…',
        help: 'Create a bot with @BotFather.',
      },
      {
        key: 'chatId',
        label: 'Default chat ID',
        kind: 'text',
        required: true,
        placeholder: '-1001234567890',
        help: 'Add the bot to the chat, then read the id from getUpdates.',
      },
    ],
    recipient: { label: 'Chat ID', placeholder: '{{input.telegramChatId}}', help: 'Leave empty to use the default chat.', defaultKey: 'chatId' },
    schema: z.object({ botToken: str.min(1), chatId: str.min(1) }),
  },
  email: {
    label: 'Email (SMTP)',
    description: 'Send email through any SMTP server (Gmail, Resend, SES, Postmark…).',
    fields: [
      { key: 'host', label: 'SMTP host', kind: 'text', required: true, placeholder: 'smtp.resend.com' },
      { key: 'port', label: 'Port', kind: 'number', required: true, placeholder: '587' },
      { key: 'encryption', label: 'Encryption', kind: 'select', options: ['tls', 'ssl', 'none'] },
      { key: 'username', label: 'Username', kind: 'text' },
      { key: 'password', label: 'Password', kind: 'password', secret: true },
      { key: 'fromEmail', label: 'From', kind: 'text', required: true, placeholder: 'Acme <hello@acme.com>' },
      {
        key: 'defaultTo',
        label: 'Default recipients',
        kind: 'text',
        placeholder: 'owner@acme.com, team@acme.com',
        help: 'Used for alerts and when a Notify node has no recipient.',
      },
    ],
    recipient: {
      label: 'To',
      placeholder: '{{input.customer.email}}',
      help: 'One or more addresses, comma separated. Empty uses the default recipients.',
      defaultKey: 'defaultTo',
    },
    schema: z.object({
      host: str.min(1),
      port: z.coerce.number().int().min(1).max(65535).default(587),
      encryption: z.enum(['tls', 'ssl', 'none']).default('tls'),
      username: str.default(''),
      password: z.string().default(''),
      fromEmail: str.min(3),
      defaultTo: str.default(''),
    }),
  },
  sms: {
    label: 'SMS (Twilio)',
    description: 'Text a phone number through Twilio.',
    fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true, placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', kind: 'password', required: true, secret: true },
      { key: 'from', label: 'From number', kind: 'text', required: true, placeholder: '+15555550100', help: 'A Twilio number or Messaging Service SID (MG…).' },
      { key: 'defaultTo', label: 'Default recipient', kind: 'text', placeholder: '+15555550123', help: 'Used for alerts.' },
    ],
    recipient: { label: 'Phone', placeholder: '{{input.customer.phone}}', help: 'E.164 format, e.g. +15555550123.', defaultKey: 'defaultTo' },
    schema: z.object({ accountSid: str.min(1), authToken: str.min(1), from: str.min(1), defaultTo: str.default('') }),
  },
  whatsapp: {
    label: 'WhatsApp (Twilio)',
    description: 'Send a WhatsApp message through Twilio.',
    fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true, placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', kind: 'password', required: true, secret: true },
      { key: 'from', label: 'WhatsApp sender', kind: 'text', required: true, placeholder: '+14155238886' },
      { key: 'defaultTo', label: 'Default recipient', kind: 'text', placeholder: '+15555550123', help: 'Used for alerts.' },
    ],
    recipient: { label: 'Phone', placeholder: '{{input.customer.phone}}', help: 'E.164 format. Outside a 24h session, WhatsApp needs an approved template.', defaultKey: 'defaultTo' },
    schema: z.object({ accountSid: str.min(1), authToken: str.min(1), from: str.min(1), defaultTo: str.default('') }),
  },
  teams: {
    label: 'Microsoft Teams',
    description: 'Post to a Teams channel through a Workflows incoming webhook.',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://…logic.azure.com/workflows/…',
        help: 'Channel → Workflows → "Post to a channel when a webhook request is received".',
      },
    ],
    recipient: null,
    schema: z.object({ webhookUrl: url }),
  },
  googlechat: {
    label: 'Google Chat',
    description: 'Post to a Google Chat space through a webhook.',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        kind: 'password',
        required: true,
        secret: true,
        placeholder: 'https://chat.googleapis.com/v1/spaces/…',
        help: 'Space → Apps & integrations → Webhooks.',
      },
    ],
    recipient: null,
    schema: z.object({ webhookUrl: url }),
  },
  ntfy: {
    label: 'ntfy (push)',
    description: 'Push notifications to phones and desktops with ntfy.',
    fields: [
      { key: 'serverUrl', label: 'Server', kind: 'text', placeholder: 'https://ntfy.sh' },
      { key: 'topic', label: 'Topic', kind: 'text', required: true, placeholder: 'acme-alerts-7f3k', help: 'Anyone who knows a public topic can read it; pick a hard-to-guess one.' },
      { key: 'token', label: 'Access token', kind: 'password', secret: true, help: 'Only for protected topics.' },
      { key: 'priority', label: 'Priority', kind: 'select', options: ['default', 'min', 'low', 'high', 'urgent'] },
    ],
    recipient: null,
    schema: z.object({
      serverUrl: z.union([url, z.literal('')]).default(''),
      topic: str.regex(/^[\w-]{1,64}$/, 'Letters, digits, - and _'),
      token: z.string().default(''),
      priority: z.enum(['default', 'min', 'low', 'high', 'urgent']).default('default'),
    }),
  },
  webhook: {
    label: 'Webhook',
    description: 'POST a JSON message to any URL (e.g. your own app).',
    fields: [
      { key: 'url', label: 'URL', kind: 'text', required: true, placeholder: 'https://hub.example.com/api/notify' },
      { key: 'headers', label: 'Headers (JSON)', kind: 'textarea', placeholder: '{ "authorization": "Bearer …" }' },
      {
        key: 'secret',
        label: 'Signing secret',
        kind: 'password',
        secret: true,
        help: 'If set, requests carry x-flows-signature: sha256=HMAC(secret, body).',
      },
    ],
    recipient: { label: 'To (optional)', placeholder: '{{input.userId}}', help: 'Passed through as "to" in the JSON.', defaultKey: '' },
    schema: z.object({
      url,
      headers: z
        .string()
        .default('')
        .refine((v) => {
          if (!v.trim()) return true;
          try {
            const parsed = JSON.parse(v);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
          } catch {
            return false;
          }
        }, 'Headers must be a JSON object'),
      secret: z.string().default(''),
    }),
  },
};

// Public description for GET /channel-types (no zod objects).
export function channelTypesForApi() {
  return CHANNEL_TYPES.map((type) => {
    const { label, description, fields, recipient } = CHANNELS[type];
    return { type, label, description, fields, recipient };
  });
}
