'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ArrowUp, ArrowDown, CircleCheck, CircleX, Clock, Lock, ShieldCheck } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { timeAgo } from '../../clients-dashboard';

export type UptimeView = {
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
  avgResponseMs: number | null;
  bar24h: { state: 'up' | 'down' | 'none'; from: number }[];
  series: { t: number; ms: number }[];
  upSince: string | null;
  downSince: string | null;
  lastCheckAt: string | null;
  incidents: {
    id: string;
    message: string;
    firstSeenAt: string;
    resolvedAt: string | null;
  }[];
};

// "5d 14h 5m" from an ISO timestamp to now.
function duration(fromIso: string): string {
  let secs = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  const d = Math.floor(secs / 86_400);
  secs -= d * 86_400;
  const h = Math.floor(secs / 3_600);
  secs -= h * 3_600;
  const m = Math.floor(secs / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function pct(v: number | null): string {
  if (v == null) return '—';
  // Show up to 3 decimals, trimming trailing zeros (99.999%, 100%).
  return `${parseFloat(v.toFixed(3))}%`;
}

const chartConfig = {
  ms: { label: 'Response', color: 'var(--chart-1)' },
} satisfies ChartConfig;

export type EndpointSummary = {
  id: string;
  name: string;
  url: string;
  method: string;
  status: 'up' | 'down' | 'pending';
  downReason: string | null;
};

export function UptimeDashboard({
  status,
  sslValidTo,
  domainExpiry,
  uptime,
  endpoints = [],
}: {
  status: string;
  sslValidTo: string | null;
  domainExpiry: string | null;
  uptime: UptimeView;
  endpoints?: EndpointSummary[];
}) {
  const isDown = status === 'down';
  const isUp = status === 'up';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {/* Top tiles: status · last check · 24h bar */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Current status</p>
              <div className="flex items-center gap-2">
                <StatusPill status={status} />
              </div>
              <p className="text-xs text-muted-foreground">
                {isDown && uptime.downSince
                  ? `Down for ${duration(uptime.downSince)}`
                  : isUp && uptime.upSince
                    ? `Up for ${duration(uptime.upSince)}`
                    : 'No pings yet'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Last check</p>
              <p className="text-2xl font-semibold tracking-tight">
                {uptime.lastCheckAt ? timeAgo(uptime.lastCheckAt) : '—'}
              </p>
              <p className="text-xs text-muted-foreground">Checked every 5m</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Last 24 hours</p>
                <span className="text-xs font-semibold text-emerald-500">
                  {pct(uptime.pct24h)}
                </span>
              </div>
              <StatusBar bar={uptime.bar24h} />
            </CardContent>
          </Card>
        </div>

        {/* Uptime stats */}
        <Card>
          <CardContent>
            <p className="mb-4 text-sm font-semibold">Uptime stats</p>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Last 24 hours" value={pct(uptime.pct24h)} />
              <Stat label="Last 7 days" value={pct(uptime.pct7d)} />
              <Stat label="Last 30 days" value={pct(uptime.pct30d)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Ping history is kept for 30 days.
            </p>
          </CardContent>
        </Card>

        {/* Response time chart */}
        <Card>
          <CardContent>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">Response time</p>
              <span className="text-xs text-muted-foreground">
                {uptime.avgResponseMs != null ? `avg ${uptime.avgResponseMs} ms` : '—'} · last 30 days
              </span>
            </div>
            {uptime.series.length === 0 ? (
              <EmptyChart />
            ) : (
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <AreaChart data={uptime.series} margin={{ left: 4, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="fillMs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-ms)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-ms)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={48}
                    tickFormatter={(t) =>
                      new Date(t).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v) => `${v}ms`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, p) =>
                          new Date(p?.[0]?.payload?.t).toLocaleString()
                        }
                        formatter={(v) => [`${v} ms`, ' Response']}
                      />
                    }
                  />
                  <Area
                    dataKey="ms"
                    type="monotone"
                    stroke="var(--color-ms)"
                    fill="url(#fillMs)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {endpoints.length > 0 && <EndpointsCard endpoints={endpoints} />}
      </div>

      {/* Right column: cert + domain, recent downtime */}
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4">
            <p className="text-sm font-semibold">Domain &amp; SSL cert</p>
            <ExpiryRow
              icon={<ShieldCheck className="size-4 text-muted-foreground" />}
              label="SSL certificate valid until"
              iso={sslValidTo}
            />
            <ExpiryRow
              icon={<Lock className="size-4 text-muted-foreground" />}
              label="Domain valid until"
              iso={domainExpiry}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm font-semibold">Recent downtime</p>
            {uptime.incidents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No outages recorded.</p>
            ) : (
              <ul className="space-y-2.5">
                {uptime.incidents.map((i) => (
                  <li key={i.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={
                        i.resolvedAt
                          ? 'mt-1 size-2 shrink-0 rounded-full bg-emerald-500'
                          : 'mt-1 size-2 shrink-0 rounded-full bg-destructive'
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate">
                        {i.resolvedAt ? 'Resolved' : 'Ongoing'} · {timeAgo(i.firstSeenAt)}
                      </p>
                      <p className="text-muted-foreground">
                        {i.resolvedAt
                          ? `Down ${outageLen(i.firstSeenAt, i.resolvedAt)}`
                          : 'Still down'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function outageLen(from: string, to: string): string {
  const mins = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function StatusPill({ status }: { status: string }) {
  if (status === 'up')
    return (
      <span className="inline-flex items-center gap-1.5 text-2xl font-bold text-emerald-500">
        <ArrowUp className="size-5" /> Up
      </span>
    );
  if (status === 'down')
    return (
      <span className="inline-flex items-center gap-1.5 text-2xl font-bold text-destructive">
        <ArrowDown className="size-5" /> Down
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-2xl font-bold text-muted-foreground">
      <Clock className="size-5" /> Unknown
    </span>
  );
}

function StatusBar({ bar }: { bar: UptimeView['bar24h'] }) {
  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-8 items-stretch gap-[2px]">
        {bar.map((slot, i) => {
        const color =
          slot.state === 'up'
            ? 'bg-emerald-500'
            : slot.state === 'down'
              ? 'bg-destructive'
              : 'bg-muted';
        const when = new Date(slot.from).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
        });
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div className={`flex-1 rounded-[2px] ${color}`} />
            </TooltipTrigger>
              <TooltipContent>
                {slot.state === 'none' ? 'No data' : slot.state === 'up' ? 'Up' : 'Down'} · {when}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-emerald-500">{value}</p>
    </div>
  );
}

function ExpiryRow({
  icon,
  label,
  iso,
}: {
  icon: React.ReactNode;
  label: string;
  iso: string | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {iso
          ? new Date(iso).toLocaleDateString(undefined, {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })
          : 'Unknown — runs on next crawl'}
      </p>
    </div>
  );
}

function EndpointsCard({ endpoints }: { endpoints: EndpointSummary[] }) {
  const down = endpoints.filter((e) => e.status === 'down').length;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Endpoints</p>
          <span className="text-xs text-muted-foreground">
            {down > 0 ? `${down} down` : `${endpoints.length} healthy`}
          </span>
        </div>
        <ul className="divide-y">
          {endpoints.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2">
                <EndpointStatusIcon status={e.status} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="mr-1.5 font-mono">{e.method}</span>
                    {e.url}
                  </p>
                </div>
              </div>
              {e.status === 'down' && e.downReason && (
                <span className="shrink-0 text-right text-xs text-destructive">Down</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function EndpointStatusIcon({ status }: { status: EndpointSummary['status'] }) {
  if (status === 'up') return <CircleCheck className="size-4 shrink-0 text-emerald-500" />;
  if (status === 'down') return <CircleX className="size-4 shrink-0 text-destructive" />;
  return <Clock className="size-4 shrink-0 text-muted-foreground" />;
}

function EmptyChart() {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      No response-time data yet — collected on each uptime ping.
    </div>
  );
}
