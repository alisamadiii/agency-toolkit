'use client';

import { Bell, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { useApp } from '@/components/app-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CHANNEL_TYPES, CHANNELS, type ChannelType } from '@/lib/channels/registry';
import { cn } from '@/lib/utils';

export type ChannelRow = {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
};

const selectClass =
  'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

// This workspace's own notification channels: used by Notify nodes and run alerts.
export function ChannelsCard({ workspaceId, channels }: { workspaceId: string; channels: ChannelRow[] }) {
  const { actions, canEdit } = useApp();
  const { updateChannelAction, deleteChannelAction, testChannelAction } = actions;
  const [editing, setEditing] = useState<{ type: ChannelType; channel?: ChannelRow } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState<string | null>(null);

  const toggle = (c: ChannelRow, enabled: boolean) =>
    start(async () => {
      const res = await updateChannelAction(workspaceId, c.id, { enabled });
      if (!res.ok) toast.error(res.error);
    });

  const remove = (c: ChannelRow) => {
    if (!confirm(`Delete "${c.name}"? Notify nodes using it will fail and it's removed from run alerts.`)) return;
    start(async () => {
      const res = await deleteChannelAction(workspaceId, c.id);
      if (res.ok) toast.success('Channel deleted');
      else toast.error(res.error);
    });
  };

  const [testFor, setTestFor] = useState<ChannelRow | null>(null);
  const [testTo, setTestTo] = useState('');

  // Channels with a recipient ask who to send the test to first.
  const startTest = (c: ChannelRow) => {
    if (CHANNELS[c.type].recipient) {
      setTestTo('');
      setTestFor(c);
    } else void test(c);
  };

  const test = async (c: ChannelRow, to?: string) => {
    setTestFor(null);
    setTesting(c.id);
    const res = await testChannelAction(workspaceId, c.id, to);
    setTesting(null);
    if (res.ok) toast.success(`Test sent via ${c.name}${res.data?.to ? ` to ${res.data.to}` : ''}`);
    else toast.error(res.error);
  };

  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-md border text-sm">
        {channels.length === 0 && (
          <li className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
            <Bell className="size-6" />
            No channels yet. Add Slack, email, SMS… and use them in Notify nodes and run alerts.
          </li>
        )}
        {channels.map((c) => (
          <li key={c.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium">
                <span className="truncate">{c.name}</span>
                <Badge variant="secondary">{CHANNELS[c.type].label}</Badge>
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">{describe(c)}</p>
            </div>
            <Switch checked={c.enabled} disabled={pending || !canEdit} onCheckedChange={(v) => toggle(c, v)} aria-label="Enabled" />
            {canEdit && (
            <>
            <Button size="sm" variant="outline" disabled={testing === c.id} onClick={() => startTest(c)}>
              {testing === c.id ? <Loader2 className="animate-spin" /> : <Send />} Test
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing({ type: c.type, channel: c })} aria-label="Edit">
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => remove(c)} aria-label="Delete">
              <Trash2 />
            </Button>
            </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <Button className="justify-self-start" onClick={() => setPicking(true)}>
          <Plus /> Add channel
        </Button>
      )}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a notification channel</DialogTitle>
            <DialogDescription>Only this workspace can use it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNEL_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setPicking(false);
                  setEditing({ type });
                }}
                className="rounded-lg border p-3 text-left hover:border-primary/50 hover:bg-muted/40"
              >
                <p className="text-sm font-medium">{CHANNELS[type].label}</p>
                <p className="text-xs text-muted-foreground">{CHANNELS[type].description}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!testFor} onOpenChange={(o) => !o && setTestFor(null)}>
        <DialogContent className="sm:max-w-md">
          {testFor && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void test(testFor, testTo.trim() || undefined);
              }}
            >
              <DialogHeader>
                <DialogTitle>Send a test via {testFor.name}</DialogTitle>
                <DialogDescription>{CHANNELS[testFor.type].recipient?.help}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label>{CHANNELS[testFor.type].recipient?.label}</Label>
                <Input
                  autoFocus
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  className="font-mono text-xs"
                  placeholder={
                    String(testFor.config[CHANNELS[testFor.type].recipient?.defaultKey ?? ''] ?? '') || 'Leave empty for the default'
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setTestFor(null)}>
                  Cancel
                </Button>
                <Button type="submit">
                  <Send /> Send test
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {editing && (
        <ChannelForm
          key={editing.channel?.id ?? editing.type}
          workspaceId={workspaceId}
          type={editing.type}
          channel={editing.channel}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function describe(c: ChannelRow) {
  const cfg = c.config as Record<string, string>;
  switch (c.type) {
    case 'email':
      return `${cfg.fromEmail} via ${cfg.host}${cfg.defaultTo ? ` → ${cfg.defaultTo}` : ''}`;
    case 'sms':
    case 'whatsapp':
      return `from ${cfg.from}${cfg.defaultTo ? ` → ${cfg.defaultTo}` : ''}`;
    case 'telegram':
      return `chat ${cfg.chatId}`;
    case 'ntfy':
      return `${(cfg.serverUrl || 'https://ntfy.sh').replace(/^https?:\/\//, '')}/${cfg.topic}`;
    case 'webhook':
      return cfg.url;
    default:
      return 'Webhook configured';
  }
}

function ChannelForm({
  workspaceId,
  type,
  channel,
  onClose,
}: {
  workspaceId: string;
  type: ChannelType;
  channel?: ChannelRow;
  onClose: () => void;
}) {
  const { createChannelAction, updateChannelAction } = useApp().actions;
  const spec = CHANNELS[type];
  const [name, setName] = useState(channel?.name ?? spec.label);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = channel?.config[f.key];
      initial[f.key] = v === undefined || v === null ? (f.kind === 'select' ? (f.options?.[0] ?? '') : '') : String(v);
    }
    if (type === 'email' && !initial.port) initial.port = '587';
    return initial;
  });
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const config: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const v = values[f.key];
        if (f.kind === 'number') config[f.key] = v === '' ? undefined : Number(v);
        else config[f.key] = v;
      }
      const res = channel
        ? await updateChannelAction(workspaceId, channel.id, { name, config })
        : await createChannelAction(workspaceId, { name, type, config });
      if (!res.ok) return void toast.error(res.error);
      toast.success(channel ? 'Channel saved' : 'Channel added. Press Test to check it.');
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{channel ? `Edit ${channel.name}` : `Add ${spec.label}`}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ops channel, Owner SMS" required />
          </div>
          {spec.fields.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label>
                {f.label}
                {f.required && <span className="text-red-500">*</span>}
              </Label>
              {f.kind === 'select' ? (
                <select
                  className={selectClass}
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                >
                  {f.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.kind === 'textarea' ? (
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              ) : (
                <Input
                  type={f.kind === 'password' ? 'password' : f.kind === 'number' ? 'number' : 'text'}
                  autoComplete="off"
                  className={cn(f.kind !== 'number' && 'font-mono text-xs')}
                  value={values[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
              {(f.help || (f.secret && channel)) && (
                <p className="text-xs text-muted-foreground">
                  {f.help}
                  {f.secret && channel ? ' Leave as is to keep the saved value.' : ''}
                </p>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Stored encrypted. Secret fields are never shown again or returned by the API.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {channel ? 'Save' : 'Add channel'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
