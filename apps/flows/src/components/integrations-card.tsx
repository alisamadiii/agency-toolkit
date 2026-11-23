'use client';

import { CalendarDays, ExternalLink, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { HubBadge } from '@/components/hub/badge';
import { Button } from '@/components/ui/button';
import type { IntegrationStatus } from '@/lib/integrations';
import { PROVIDERS } from '@/lib/integrations/registry';

// Apps come from the client hub: the project connects Google there (Calendar app)
// and workflows here use that connection. This card only shows the status.
export function IntegrationsCard({ integrations, hubOrigins }: { integrations: IntegrationStatus[]; hubOrigins: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Inside the hub's iframe, link to the hub that is actually framing us.
  const hubUrl = (path: string) => {
    const framed = typeof window !== 'undefined' && window.top !== window.self;
    const parent = framed ? window.location.ancestorOrigins?.[0] : undefined;
    const origin = parent && hubOrigins.includes(parent) ? parent : hubOrigins[0];
    return origin ? `${origin}${path}` : null;
  };

  return (
    <div className="grid gap-3">
      {integrations.map((item) => {
        const spec = PROVIDERS[item.provider];
        return (
          <div key={item.provider} className="flex flex-wrap items-center gap-4 rounded-inner border border-line bg-surface p-4">
            <div className="flex size-10 items-center justify-center rounded-inner bg-info-soft text-info-text">
              <CalendarDays className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                {spec.label}
                {item.connected ? <HubBadge tone="success">Connected</HubBadge> : <HubBadge>Not connected</HubBadge>}
              </p>
              <p className="mt-0.5 text-[13px] text-dim">
                {item.connected
                  ? `Connected through the client hub${item.accountEmail ? ` as ${item.accountEmail}` : ''}.`
                  : (item.reason ?? spec.description)}
              </p>
              {item.connected && item.calendars && item.calendars.length > 0 && (
                <p className="mt-1 text-xs text-faint">
                  Calendars: {item.calendars.map((c) => (c.primary ? `${c.name} (primary)` : c.name)).join(', ')}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!item.connected && hubOrigins.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const url = hubUrl('/calendar');
                    if (!url) return;
                    // Leave the iframe: the hub's Calendar app handles Google sign-in.
                    if (window.top !== window.self) window.open(url, '_top');
                    else window.open(url, '_blank', 'noopener');
                  }}
                >
                  <ExternalLink /> Connect in the client hub
                </Button>
              )}
              <Button variant="ghost" size="icon" aria-label="Check again" disabled={pending} onClick={() => start(() => router.refresh())}>
                <RefreshCw className={pending ? 'animate-spin' : undefined} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
