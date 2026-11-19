'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { updateSchedule } from '@/app/actions/jobs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RunStatusBadge } from '@/components/run-status-badge';

import { timeAgo } from '../clients-dashboard';

export type JobExecutionView = {
  id: string;
  jobName: string;
  trigger: string;
  status: string;
  startedAt: string;
  durationMs: number | null;
  summary: string;
};

const PING_OPTIONS = [1, 5, 10, 15, 30];
const CRAWL_OPTIONS = [1, 6, 12, 24, 48];

const JOB_LABELS: Record<string, string> = {
  'uptime-pulse': 'Uptime ping',
  'deep-crawl': 'Full check',
  retention: 'Cleanup',
};

export function JobsClient({
  schedule,
  executions,
}: {
  schedule: { uptimePulseIntervalMinutes: number; deepCrawlIntervalHours: number };
  executions: JobExecutionView[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Jobs</h1>
        <p className="text-muted-foreground">
          Background checks — their schedule and every past run.
        </p>
      </div>

      <ScheduleCard schedule={schedule} />

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Recent runs</CardTitle>
          <CardDescription>
            Click a run to see which sites it covered and each one&apos;s result.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {executions.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No jobs have run yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="text-right">Trigger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((e) => (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/jobs/${e.id}`)}
                  >
                    <TableCell className="font-medium">
                      {JOB_LABELS[e.jobName] ?? e.jobName}
                    </TableCell>
                    <TableCell>{timeAgo(e.startedAt)}</TableCell>
                    <TableCell>{formatDuration(e.durationMs)}</TableCell>
                    <TableCell>
                      <RunStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {e.summary}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="text-[10px]">
                        {e.trigger}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {/* refresh helper so new runs show without a manual reload */}
      <RefreshOnFocus onRefresh={() => router.refresh()} />
    </div>
  );
}

function ScheduleCard({
  schedule,
}: {
  schedule: { uptimePulseIntervalMinutes: number; deepCrawlIntervalHours: number };
}) {
  const [ping, setPing] = React.useState(schedule.uptimePulseIntervalMinutes);
  const [crawl, setCrawl] = React.useState(schedule.deepCrawlIntervalHours);
  const [saving, setSaving] = React.useState(false);

  const dirty =
    ping !== schedule.uptimePulseIntervalMinutes ||
    crawl !== schedule.deepCrawlIntervalHours;

  async function handleSave() {
    setSaving(true);
    const result = await updateSchedule({
      uptimePulseIntervalMinutes: ping,
      deepCrawlIntervalHours: crawl,
    });
    setSaving(false);
    if (result.error) toast.error(result.error);
    else toast.success('Schedule saved — applies within a minute');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">Schedule</CardTitle>
        <CardDescription>
          How often checks run for every website. Changes apply within a minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-6">
        <div className="space-y-1.5">
          <Label>Uptime ping every</Label>
          <Select value={String(ping)} onValueChange={(v) => setPing(Number(v))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PING_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} minute{n === 1 ? '' : 's'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Full check every</Label>
          <Select value={String(crawl)} onValueChange={(v) => setCrawl(Number(v))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CRAWL_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} hour{n === 1 ? '' : 's'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save schedule
        </Button>
      </CardContent>
    </Card>
  );
}

function RefreshOnFocus({ onRefresh }: { onRefresh: () => void }) {
  React.useEffect(() => {
    window.addEventListener('focus', onRefresh);
    return () => window.removeEventListener('focus', onRefresh);
  }, [onRefresh]);
  return null;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
