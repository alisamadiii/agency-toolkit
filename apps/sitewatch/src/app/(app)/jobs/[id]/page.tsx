import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/db';
import { clients, jobExecutions, runs, uptimeChecks } from '@/db/schema';
import { RunStatusBadge } from '@/components/run-status-badge';
import { requireSession } from '@/lib/session';

const JOB_LABELS: Record<string, string> = {
  'uptime-pulse': 'Uptime ping',
  'deep-crawl': 'Full check',
  retention: 'Cleanup',
};

export default async function JobExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireSession();
  const { id } = await params;

  const [exec] = await db.select().from(jobExecutions).where(eq(jobExecutions.id, id));
  if (!exec) notFound();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/jobs" className="hover:underline">
            Jobs
          </Link>{' '}
          — {exec.startedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
        </p>
        <h1 className="flex items-center gap-3 font-heading text-3xl font-bold tracking-tight">
          {JOB_LABELS[exec.jobName] ?? exec.jobName}
          <RunStatusBadge status={exec.status} />
        </h1>
        <p className="text-muted-foreground">
          {exec.trigger} ·{' '}
          {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : 'running…'}
          {exec.finishedAt
            ? ` · finished ${exec.finishedAt.toISOString().slice(11, 19)} UTC`
            : ''}
        </p>
      </div>

      {exec.error && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="font-heading text-lg text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto text-sm">{exec.error}</pre>
          </CardContent>
        </Card>
      )}

      {exec.jobName === 'deep-crawl' && <DeepCrawlDomains execId={exec.id} userId={user.id} />}
      {exec.jobName === 'uptime-pulse' && (
        <UptimeProbes
          userId={user.id}
          from={exec.startedAt}
          to={exec.finishedAt ?? new Date()}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Raw result</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs">
            {JSON.stringify(exec.result ?? {}, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

async function DeepCrawlDomains({ execId, userId }: { execId: string; userId: string }) {
  const rows = await db
    .select({
      runId: runs.id,
      clientId: clients.id,
      name: clients.name,
      baseUrl: clients.baseUrl,
      status: runs.status,
      pagesChecked: runs.pagesChecked,
      pagesTotal: runs.pagesTotal,
      errorCount: runs.errorCount,
      warningCount: runs.warningCount,
    })
    .from(runs)
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(and(eq(runs.jobExecutionId, execId), eq(clients.userId, userId)))
    .orderBy(desc(runs.errorCount));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">
          Domains covered ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No sites in this run.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Warnings</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.runId}>
                  <TableCell className="font-medium">
                    <Link href={`/clients/${r.clientId}`} className="hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.baseUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    {r.pagesChecked}/{r.pagesTotal}
                  </TableCell>
                  <TableCell>
                    {r.errorCount > 0 ? (
                      <span className="text-destructive">{r.errorCount}</span>
                    ) : (
                      '0'
                    )}
                  </TableCell>
                  <TableCell>{r.warningCount}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/runs/${r.runId}`} className="text-sm hover:underline">
                      View run
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function UptimeProbes({
  userId,
  from,
  to,
}: {
  userId: string;
  from: Date;
  to: Date;
}) {
  // Small buffer so probes that finished just after the execution window land.
  const toBuffered = new Date(to.getTime() + 5_000);
  const rows = await db
    .select({
      name: clients.name,
      baseUrl: clients.baseUrl,
      ok: uptimeChecks.ok,
      status: uptimeChecks.status,
      responseMs: uptimeChecks.responseMs,
      error: uptimeChecks.error,
    })
    .from(uptimeChecks)
    .innerJoin(clients, eq(uptimeChecks.clientId, clients.id))
    .where(
      and(
        eq(clients.userId, userId),
        gte(uptimeChecks.checkedAt, from),
        lte(uptimeChecks.checkedAt, toBuffered)
      )
    )
    .orderBy(asc(clients.name));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">
          Per-domain probes ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No probes recorded in this window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead className="text-right">Response</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    {r.name}
                    <span className="block text-xs text-muted-foreground">
                      {r.baseUrl.replace(/^https?:\/\//, '')}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.ok ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        up
                      </Badge>
                    ) : (
                      <Badge variant="destructive">down</Badge>
                    )}
                    {r.error && (
                      <span className="ml-2 text-xs text-muted-foreground">{r.error}</span>
                    )}
                  </TableCell>
                  <TableCell>{r.status ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {r.responseMs != null ? `${r.responseMs}ms` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
