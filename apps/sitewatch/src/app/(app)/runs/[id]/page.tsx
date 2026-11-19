import { readdir } from 'node:fs/promises';
import path from 'node:path';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

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
import { clients, findings, runs } from '@/db/schema';
import { screenshotsDir } from '@/lib/checker/crawl';
import { requireSession } from '@/lib/session';

import { RunStatusBadge } from '@/components/run-status-badge';

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireSession();
  const { id } = await params;

  const [row] = await db
    .select({ run: runs, client: clients })
    .from(runs)
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(and(eq(runs.id, id), eq(clients.userId, user.id)));
  if (!row) notFound();

  const rows = await db
    .select()
    .from(findings)
    .where(eq(findings.runId, id))
    .orderBy(findings.severity, findings.checkType);

  let screenshots: string[] = [];
  try {
    screenshots = (await readdir(path.join(screenshotsDir(), id))).filter((f) =>
      f.endsWith('.png')
    );
  } catch {
    // none captured
  }

  const { run, client } = row;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/clients/${client.id}`} className="hover:underline">
            {client.name}
          </Link>{' '}
          — {run.startedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
        </p>
        <h1 className="flex items-center gap-3 font-heading text-3xl font-bold tracking-tight">
          Check result <RunStatusBadge status={run.status} />
        </h1>
        <p className="text-muted-foreground">
          {run.pagesChecked} of {run.pagesTotal} pages checked — {run.errorCount}{' '}
          errors, {run.warningCount} warnings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">
            Findings ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              Nothing wrong found on this run. 🎉
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Severity</TableHead>
                  <TableHead className="w-36">Check</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead className="w-48">Page</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      {f.severity === 'error' ? (
                        <Badge variant="destructive">error</Badge>
                      ) : (
                        <Badge variant="secondary">warning</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.checkType}</TableCell>
                    <TableCell className="text-sm">{f.message}</TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs">
                      {pathOf(f.pageUrl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {screenshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Screenshots</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {screenshots.map((file) => (
              // eslint-disable-next-line @next/next/no-img-element
              <figure key={file} className="space-y-1">
                <img
                  src={`/api/screenshots/${run.id}/${file}`}
                  alt={file}
                  className="w-full rounded-lg border"
                />
                <figcaption className="text-center font-mono text-xs text-muted-foreground">
                  {file.replace(/\.png$/, '')}
                </figcaption>
              </figure>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '/' : u.pathname;
  } catch {
    return url;
  }
}
