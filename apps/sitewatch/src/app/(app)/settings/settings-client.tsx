'use client';

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import {
  saveChannel,
  testChannel,
  toggleChannel,
} from '@/app/actions/notification-channels';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ChannelType } from '@/lib/notifications/types';

export type ChannelView = {
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
};

type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password';
  hint?: string;
};

const CHANNEL_DEFS: {
  type: ChannelType;
  title: string;
  description: string;
  fields: FieldDef[];
}[] = [
  {
    type: 'discord',
    title: 'Discord',
    description: 'Down/up alerts and new problems go to a channel webhook.',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…' },
      { key: 'botUsername', label: 'Bot username (optional)' },
      { key: 'botAvatarUrl', label: 'Bot avatar URL (optional)' },
    ],
  },
  {
    type: 'slack',
    title: 'Slack',
    description: 'Alerts via an incoming webhook.',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/…' },
    ],
  },
  {
    type: 'telegram',
    title: 'Telegram',
    description: 'Messages you through a bot.',
    fields: [
      { key: 'botToken', label: 'Bot token', type: 'password' },
      { key: 'chatId', label: 'Chat ID' },
    ],
  },
  {
    type: 'email',
    title: 'Email (SMTP)',
    description: 'Alerts to your own inbox over SMTP.',
    fields: [
      { key: 'host', label: 'SMTP host', placeholder: 'smtp.example.com' },
      { key: 'port', label: 'Port', placeholder: '587' },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', type: 'password' },
      { key: 'fromEmail', label: 'From email', placeholder: 'tracker@example.com' },
      { key: 'encryption', label: 'Encryption (tls / ssl / none)', placeholder: 'tls' },
    ],
  },
  {
    type: 'webhook',
    title: 'Webhook',
    description:
      'POSTs full incident JSON to your own endpoint (e.g. the client hub) on every state change — new problems, fixes, down/up.',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://your-hub.com/api/monitoring-webhook' },
      {
        key: 'headers',
        label: 'Extra headers (JSON, optional)',
        placeholder: '{"authorization": "Bearer …"}',
      },
      {
        key: 'secret',
        label: 'Secret (optional)',
        type: 'password',
        hint: 'Sent as the x-webhook-secret header so your endpoint can verify the sender.',
      },
    ],
  },
];

export function SettingsClient({ channels }: { channels: ChannelView[] }) {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Notifications
        </h1>
        <p className="text-muted-foreground">
          Where alerts go when a site goes down or a check finds a new problem.
        </p>
      </div>
      {CHANNEL_DEFS.map((def) => (
        <ChannelCard
          key={def.type}
          def={def}
          saved={channels.find((c) => c.type === def.type) ?? null}
        />
      ))}
    </div>
  );
}

function ChannelCard({
  def,
  saved,
}: {
  def: (typeof CHANNEL_DEFS)[number];
  saved: ChannelView | null;
}) {
  const [form, setForm] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      def.fields.map((f) => [f.key, String(saved?.config[f.key] ?? '')])
    )
  );
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await saveChannel(def.type, form);
    setSaving(false);
    if (result.error) toast.error(result.error);
    else toast.success(`${def.title} saved and enabled`);
  }

  async function handleTest() {
    setTesting(true);
    const result = await testChannel(def.type);
    setTesting(false);
    if (result.error) toast.error(`Test failed: ${result.error}`);
    else toast.success('Test message sent — check the channel');
  }

  async function handleToggle() {
    const result = await toggleChannel(def.type);
    if (result.error) toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="font-heading">{def.title}</CardTitle>
            <CardDescription>{def.description}</CardDescription>
          </div>
          <Switch
            checked={saved?.enabled ?? false}
            onCheckedChange={handleToggle}
            disabled={!saved}
          />
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          {def.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                type={f.type ?? 'text'}
              />
              {f.hint && (
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={testing || !saved}
            >
              {testing ? <Loader2 className="animate-spin" /> : <Send />}
              Send test
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
