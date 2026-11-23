'use client';

import { CalendarDays, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { useApp } from '@/components/app-context';
import { HubBadge } from '@/components/hub/badge';
import { Button } from '@/components/ui/button';
import { PROVIDERS, type ProviderId } from '@/lib/integrations/registry';

export type IntegrationRow = {
  provider: string;
  label: string;
  connected: boolean;
  accountEmail?: string;
  status?: string;
  settings?: Record<string, unknown>;
};

const selectClass =
  'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

// This workspace's connected apps. Connecting opens Google's sign-in in a popup
// (Google doesn't allow sign-in inside an iframe); the page notices when it's done.
export function IntegrationsCard({
  workspaceId,
  integrations,
  configured,
}: {
  workspaceId: string;
  integrations: IntegrationRow[];
  configured: boolean;
}) {
  return (
    <div className="grid gap-3">
      {integrations.map((i) => (
        <IntegrationItem key={i.provider} workspaceId={workspaceId} item={i} configured={configured} />
      ))}
    </div>
  );
}

function IntegrationItem({ workspaceId, item, configured }: { workspaceId: string; item: IntegrationRow; configured: boolean }) {
  const router = useRouter();
  const { actions, canEdit } = useApp();
  const spec = PROVIDERS[item.provider as ProviderId];
  const [waiting, setWaiting] = useState(false);
  const [pending, start] = useTransition();
  const [calendars, setCalendars] = useState<{ id: string; name: string }[] | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    setWaiting(false);
  };

  // Done: the popup posts a message (same origin), or polling sees the new status.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { source?: string; type?: string })?.type === 'integration-connected') {
        stopPolling();
        toast.success(`${spec.label} connected`);
        router.refresh();
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (poll.current) clearInterval(poll.current);
    };
  }, [router, spec.label]);

  useEffect(() => {
    if (!item.connected || !canEdit || calendars) return;
    actions.integrationCalendarsAction(workspaceId).then((res) => {
      if (res.ok && res.data) setCalendars(res.data);
    });
  }, [actions, calendars, canEdit, item.connected, workspaceId]);

  const connect = async () => {
    // Open the window first (in the click) so popup blockers allow it.
    const popup = window.open('about:blank', 'flows-connect', 'width=520,height=680');
    const res = await actions.startIntegrationConnectAction(workspaceId, item.provider);
    if (!res.ok || !res.data) {
      popup?.close();
      toast.error(res.ok ? 'Could not start sign-in' : res.error);
      return;
    }
    if (popup) popup.location.href = res.data.url;
    else window.open(res.data.url, '_blank');
    setWaiting(true);
    const started = Date.now();
    poll.current = setInterval(async () => {
      const status = await actions.integrationStatusAction(workspaceId);
      const row = status.ok && status.data ? status.data.find((r) => r.provider === item.provider) : null;
      if (row?.connected && row.updatedAt && new Date(row.updatedAt).getTime() >= started - 5000) {
        stopPolling();
        toast.success(`${spec.label} connected`);
        router.refresh();
      } else if (Date.now() - started > 5 * 60_000) stopPolling();
    }, 2000);
  };

  const disconnect = () => {
    if (!confirm(`Disconnect ${spec.label}? Workflows using it will fail until you connect again.`)) return;
    start(async () => {
      const res = await actions.disconnectIntegrationAction(workspaceId, item.provider);
      if (res.ok) {
        toast.success('Disconnected');
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const setCalendar = (calendarId: string) =>
    start(async () => {
      const res = await actions.setIntegrationSettingsAction(workspaceId, item.provider, { calendarId });
      if (res.ok) toast.success('Default calendar saved');
      else toast.error(res.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-inner border border-line bg-surface p-4">
      <div className="flex size-10 items-center justify-center rounded-inner bg-info-soft text-info-text">
        <CalendarDays className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          {spec.label}
          {item.connected ? (
            item.status === 'needs_reconnect' ? (
              <HubBadge tone="warning">Reconnect needed</HubBadge>
            ) : (
              <HubBadge tone="success">Connected</HubBadge>
            )
          ) : (
            <HubBadge>Not connected</HubBadge>
          )}
        </p>
        <p className="mt-0.5 text-[13px] text-dim">
          {item.connected ? `Signed in as ${item.accountEmail}` : spec.description}
        </p>
        {item.connected && canEdit && calendars && calendars.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-3">
            Default calendar
            <select
              className={selectClass}
              defaultValue={String(item.settings?.calendarId ?? 'primary')}
              disabled={pending}
              onChange={(e) => setCalendar(e.target.value)}
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          {(!item.connected || item.status === 'needs_reconnect') && (
            <Button onClick={connect} disabled={waiting || !configured}>
              {waiting ? <Loader2 className="animate-spin" /> : null}
              {waiting ? 'Waiting for Google…' : item.connected ? 'Reconnect' : `Connect ${spec.label}`}
            </Button>
          )}
          {item.connected && (
            <Button variant="outline" onClick={disconnect} disabled={pending}>
              Disconnect
            </Button>
          )}
        </div>
      )}
      {!configured && canEdit && (
        <p className="w-full text-xs text-faint">Google sign-in isn&apos;t set up on this server yet (GOOGLE_CLIENT_ID).</p>
      )}
    </div>
  );
}
