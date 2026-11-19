import Link from 'next/link';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { ArrowRight, CalendarClock, MapPin, Palette, Sparkles, Store, Zap } from 'lucide-react';

import { LeadsChart } from '@/components/leads-chart';
import { NextRunCountdown } from '@/components/next-run';
import { PageHeader } from '@/components/page-header';
import { LeadStatusBadge, RunStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { leads, runs } from '@/db/schema';
import { ago, dateTime } from '@/lib/format';
import { getSettings } from '@/lib/jobs/settings';
import { nextRunAt, zonedParts } from '@/lib/time';

export const dynamic = 'force-dynamic';

const CHART_DAYS = 14;

async function loadOverview() {
  const s = await getSettings();
  const now = Date.now();
  const since = new Date(now - CHART_DAYS * 86_400_000);

  const [[totals], [lastRun], perDay, [apiWeek], fresh] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        fresh: sql<number>`count(*) filter (where ${leads.status} = 'new' and not ${leads.designReady})::int`,
        designReady: sql<number>`count(*) filter (where ${leads.designReady})::int`,
        today: sql<number>`count(*) filter (where ${leads.firstSeenAt} > now() - interval '24 hours')::int`,
      })
      .from(leads),
    db.select().from(runs).orderBy(desc(runs.startedAt)).limit(1),
    db
      .select({
        day: sql<string>`to_char(${leads.firstSeenAt} at time zone ${s.timezone}, 'YYYY-MM-DD')`,
        leads: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(gte(leads.firstSeenAt, since))
      .groupBy(sql`1`),
    db
      .select({ calls: sql<number>`coalesce(sum(${runs.apiCalls}), 0)::int` })
      .from(runs)
      .where(gte(runs.startedAt, new Date(now - 7 * 86_400_000))),
    db
      .select()
      .from(leads)
      .where(eq(leads.status, 'new'))
      .orderBy(desc(sql`${leads.reviewCount} * ${leads.rating}`))
      .limit(5),
  ]);

  const byDay = new Map(perDay.map((d) => [d.day, d.leads]));
  const chart = Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = zonedParts(new Date(now - (CHART_DAYS - 1 - i) * 86_400_000), s.timezone).day;
    return { day, leads: byDay.get(day) ?? 0 };
  });

  const next = s.enabled ? nextRunAt(s.runTime, s.timezone) : null;
  return { s, totals, lastRun, chart, apiWeek, fresh, next };
}

export default async function OverviewPage() {
  const { s, totals, lastRun, chart, apiWeek, fresh, next } = await loadOverview();
  const homeMissing = s.homeLat == null || s.homeLng == null;

  const kpis = [
    { label: 'Total leads', value: totals.total, icon: Store },
    { label: 'Waiting for design', value: totals.fresh, icon: Sparkles },
    { label: 'Design ready', value: totals.designReady, icon: Palette },
    { label: 'API calls · 7d', value: apiWeek.calls, icon: Zap },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Overview"
        description={`Businesses near you with great reviews and no website · ${totals.today} new in the last 24h`}
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">Schedule & search</Link>
        </Button>
      </PageHeader>

      {homeMissing && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <MapPin className="size-4 text-amber-600" />
              Set your home location before the first run.
            </span>
            <Button asChild size="sm">
              <Link href="/settings">Open settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-2">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <k.icon className="size-4" />
                {k.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="font-heading text-3xl font-semibold tabular-nums">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>New leads per day</CardTitle>
            <CardDescription>Last {CHART_DAYS} days</CardDescription>
          </CardHeader>
          <CardContent>
            <LeadsChart data={chart} />
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <CalendarClock className="size-4" />
                Next run
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-semibold">
                <NextRunCountdown at={next?.toISOString() ?? null} />
              </div>
              <p className="text-sm text-muted-foreground">
                {s.enabled ? `Daily at ${s.runTime} · ${s.timezone}` : 'Schedule is paused'}
              </p>
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardDescription>Last run</CardDescription>
              {lastRun && (
                <CardAction>
                  <RunStatusBadge status={lastRun.status} />
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {lastRun ? (
                <>
                  <div className="text-2xl font-semibold tabular-nums">
                    {lastRun.newLeadsSaved} <span className="text-base font-normal text-muted-foreground">new leads</span>
                  </div>
                  <p className="text-muted-foreground">
                    {dateTime(lastRun.startedAt, s.timezone)} · {ago(lastRun.startedAt)} · {lastRun.apiCalls} calls
                  </p>
                  {lastRun.errors.length > 0 && (
                    <p className="text-rose-600 dark:text-rose-400">
                      {lastRun.errors.length} error{lastRun.errors.length === 1 ? '' : 's'}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">No runs yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Up next to design</CardTitle>
          <CardDescription>Highest rating × reviews among new leads</CardDescription>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href="/leads">
                All leads <ArrowRight />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {fresh.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting. The next run will add more.</p>
          ) : (
            <ul className="divide-y">
              {fresh.map((l) => (
                <li key={l.placeId}>
                  <Link
                    href={`/leads?lead=${encodeURIComponent(l.placeId)}`}
                    className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        <span className="capitalize">{l.category}</span> · {l.distanceMiles} mi
                      </div>
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      <div>⭐ {l.rating.toFixed(1)}</div>
                      <div className="text-muted-foreground">{l.reviewCount} reviews</div>
                    </div>
                    <LeadStatusBadge status={l.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
