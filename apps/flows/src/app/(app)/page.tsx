import { count, eq, sql as dsql } from 'drizzle-orm';
import Link from 'next/link';

import { ApiKeys, CreateWorkspaceForm } from '@/components/dashboard-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { run, workspace } from '@/db/schema';
import { listApiKeys } from '@/lib/service';

export default async function HomePage() {
  const workspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      // Qualified on purpose: inside a single-table select drizzle drops table names,
      // which would make these subqueries compare their own columns.
      workflows: dsql<number>`(SELECT count(*)::int FROM workflow wf WHERE wf.workspace_id = "workspace"."id")`,
      runs24h: dsql<number>`(SELECT count(*)::int FROM run r WHERE r.workspace_id = "workspace"."id" AND r.queued_at > now() - interval '24 hours')`,
      failed24h: dsql<number>`(SELECT count(*)::int FROM run r WHERE r.workspace_id = "workspace"."id" AND r.status IN ('failed','timeout') AND r.queued_at > now() - interval '24 hours')`,
    })
    .from(workspace)
    .orderBy(workspace.name);
  const [{ value: queued }] = await db.select({ value: count() }).from(run).where(eq(run.status, 'queued'));
  const adminKeys = await listApiKeys(null);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <p className="text-sm text-muted-foreground">One per client. {queued} run(s) waiting in the queue.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <CreateWorkspaceForm />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {workspaces.length === 0 && <p className="text-sm text-muted-foreground">No workspaces yet.</p>}
        {workspaces.map((w) => (
          <Link key={w.id} href={`/w/${w.id}`}>
            <Card className="transition-colors hover:bg-muted/40">
              <CardHeader>
                <CardTitle>{w.name}</CardTitle>
                <CardDescription className="font-mono text-xs">{w.slug}</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4 text-sm text-muted-foreground">
                <span>{w.workflows} workflows</span>
                <span>{w.runs24h} runs / 24h</span>
                {w.failed24h > 0 && <span className="text-red-600">{w.failed24h} failed</span>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Admin API keys</CardTitle>
          <CardDescription>
            Full access: create workspaces and keys, and act on any workspace with the <code>x-workspace-id</code> header. Give
            the client hub an admin key, or one workspace key per client.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeys workspaceId={null} keys={adminKeys} path="/" />
        </CardContent>
      </Card>
    </div>
  );
}
