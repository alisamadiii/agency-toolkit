'use client';

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

import { saveChannel, testChannel, toggleChannel } from '@/app/actions/notification-channels';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const FIELDS = [
  { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…' },
  { key: 'botUsername', label: 'Bot username (optional)', placeholder: 'Lead Finder' },
  { key: 'botAvatarUrl', label: 'Bot avatar URL (optional)', placeholder: 'https://…' },
];

export function ChannelCard({
  saved,
}: {
  saved: { enabled: boolean; config: Record<string, unknown> } | null;
}) {
  const [form, setForm] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(saved?.config[f.key] ?? '')]))
  );
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await saveChannel('discord', form);
    setSaving(false);
    if (result.error) toast.error(result.error);
    else toast.success('Discord saved and enabled');
  }

  async function handleTest() {
    setTesting(true);
    const result = await testChannel('discord');
    setTesting(false);
    if (result.error) toast.error(`Test failed: ${result.error}`);
    else toast.success('Test message sent. Check the channel.');
  }

  async function handleToggle() {
    const result = await toggleChannel('discord');
    if (result.error) toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discord</CardTitle>
        <CardDescription>
          Optional. Each run posts its new leads to a channel webhook. Off = runs stay silent.
        </CardDescription>
        <CardAction>
          <Switch checked={saved?.enabled ?? false} onCheckedChange={handleToggle} disabled={!saved} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing || !saved}>
              {testing ? <Loader2 className="animate-spin" /> : <Send />}
              Send test
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
