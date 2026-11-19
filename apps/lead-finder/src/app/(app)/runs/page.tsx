import { desc } from 'drizzle-orm';

import { PageHeader } from '@/components/page-header';
import { RunStatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/db';
import { runs } from '@/db/schema';
import { dateTime, duration } from '@/lib/format';
import { getSettings } from '@/lib/jobs/settings';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const [rows, s] = await Promise.all([
    db.select().from(runs).orderBy(desc(runs.startedAt)).limit(100),
    getSettings(),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Runs" description="Every scheduled and manual run, newest first" />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Started</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Trigger</TableHead>
              <TableHead className="text-right">New leads</TableHead>
              <TableHead className="hidden text-right md:table-cell">Places seen</TableHead>
              <TableHead className="text-right">API calls</TableHead>
              <TableHead className="hidden pr-4 text-right md:table-cell">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No runs yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="pl-4">
                  <div>{dateTime(r.startedAt, s.timezone)}</div>
                  {r.errors.length > 0 && (
                    <details className="mt-1 max-w-md text-xs">
                      <summary className="cursor-pointer text-rose-600 dark:text-rose-400">
                        {r.errors.length} error{r.errors.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="mt-1 space-y-1 font-mono whitespace-pre-wrap text-muted-foreground">
                        {r.errors.map((e, i) => (
                          <li key={i}>{e.message}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </TableCell>
                <TableCell>
                  <RunStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="hidden capitalize text-muted-foreground sm:table-cell">{r.trigger}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{r.newLeadsSaved}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{r.candidatesSeen}</TableCell>
                <TableCell className="text-right tabular-nums">{r.apiCalls}</TableCell>
                <TableCell className="hidden pr-4 text-right text-muted-foreground tabular-nums md:table-cell">
                  {duration(r.startedAt, r.finishedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
