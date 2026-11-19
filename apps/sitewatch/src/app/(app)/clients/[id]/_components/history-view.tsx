'use client';

import Link from 'next/link';

import { RunStatusBadge } from '@/components/run-status-badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { timeAgo } from '../../../clients-dashboard';

export type RunView = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  pagesChecked: number;
  pagesTotal: number;
  errorCount: number;
  warningCount: number;
};

export function HistoryView({ runs }: { runs: RunView[] }) {
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead className="text-right">Problems</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Link href={`/runs/${run.id}`} className="hover:underline">
                    {timeAgo(run.startedAt)}
                  </Link>
                </TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell>
                  {run.pagesChecked}/{run.pagesTotal}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {run.errorCount > 0 && (
                    <span className="text-destructive">{run.errorCount} errors </span>
                  )}
                  {run.warningCount > 0 && (
                    <span className="text-muted-foreground">{run.warningCount} warnings</span>
                  )}
                  {run.errorCount === 0 && run.warningCount === 0 && '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
