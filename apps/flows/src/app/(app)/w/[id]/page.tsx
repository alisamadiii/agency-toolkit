import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChannelsCard } from '@/components/channels-card';
import { IntegrationsCard } from '@/components/integrations-card';
import { ApiKeys, Secrets, WorkspaceSettingsForm } from '@/components/dashboard-forms';
import { CopyText } from '@/components/copy-text';
import { RunsTable } from '@/components/runs-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { db } from '@/db';
import { workflow } from '@/db/schema';
import { decrypt } from '@/lib/crypto';
import { embedAllowedOrigins } from '@/lib/embed';
import { integrationStatus } from '@/lib/integrations';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

const TABS = ['workflows', 'runs', 'integrations', 'notifications', 'keys', 'settings'];

export default async function WorkspacePage({ params, searchParams }: PageProps<'/w/[id]'>) {
  const { id } = await params;
  const { tab } = await searchParams;
  if (!isUuid(id)) notFound();
  const ws = await service.getWorkspace(id).catch(() => null);
  if (!ws) notFound();

  const [workflows, schedules, keys, secrets, runs, channels, integrations] = await Promise.all([
    service.listWorkflows(id),
    service.listSchedules(id),
    service.listApiKeys(id),
    service.listSecrets(id),
    service.listRuns(id, { limit: 30 }),
    service.listChannels(id),
    integrationStatus(id),
  ]);
  const names = new Map(
    (await db.select({ id: workflow.id, name: workflow.name }).from(workflow).where(eq(workflow.workspaceId, id))).map((w) => [
      w.id,
      w.name,
    ])
  );

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Workspaces
        </Link>
        <h1 className="text-2xl font-semibold">{ws.name}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          workspace id {ws.id}
          {ws.externalId && (ws.externalId === ws.id ? ' · same as its client hub project id' : ` · client hub project ${ws.externalId}`)}
        </p>
      </div>

      <Tabs defaultValue={TABS.includes(tab as string) ? (tab as string) : 'workflows'} className="grid gap-4">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="keys">Keys &amp; secrets</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="workflows">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Workflows</CardTitle>
                <CardDescription>A cron job is a workflow with a schedule.</CardDescription>
              </div>
              <Button asChild size="sm">
                <Link href={`/w/${id}/workflows/new`}>New workflow</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-md border text-sm">
                {workflows.length === 0 && <li className="p-3 text-muted-foreground">No workflows yet.</li>}
                {workflows.map((wf) => {
                  const count = schedules.filter((s) => s.workflowId === wf.id && s.enabled).length;
                  return (
                    <li key={wf.id}>
                      <Link href={`/w/${id}/workflows/${wf.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/40">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{wf.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {wf.graph.nodes.length - 1} node{wf.graph.nodes.length === 2 ? '' : 's'} · {count} active schedule{count === 1 ? '' : 's'}
                          </p>
                        </div>
                        {!wf.enabled && <Badge variant="secondary">Disabled</Badge>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
            </CardHeader>
            <CardContent>
              <RunsTable showWorkflow runs={runs.data.map((r) => ({ ...r, workflowName: names.get(r.workflowId) }))} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Apps connected in the client hub for this project, used by app steps on the canvas.</CardDescription>
            </CardHeader>
            <CardContent>
              <IntegrationsCard integrations={integrations} hubOrigins={embedAllowedOrigins()} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification channels</CardTitle>
              <CardDescription>
                This workspace&apos;s own Slack, email, SMS and other destinations. Use them in Notify nodes and run alerts.
                Other workspaces can&apos;t see or use them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChannelsCard workspaceId={id} channels={channels} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>API keys</CardTitle>
                <CardDescription>Only see and change this workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <ApiKeys workspaceId={id} keys={keys} path={`/w/${id}`} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Secrets</CardTitle>
                <CardDescription>Encrypted. Use in nodes as {'{{secrets.NAME}}'} or `secrets.NAME` in scripts.</CardDescription>
              </CardHeader>
              <CardContent>
                <Secrets workspaceId={id} names={secrets.map((s) => s.name)} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">Callback signing secret</p>
                <CopyText text={decrypt(ws.signingSecret)} className="break-all rounded-md border bg-muted/40 p-2 text-left font-mono text-xs">
                  {decrypt(ws.signingSecret)}
                </CopyText>
                <p className="text-xs text-muted-foreground">
                  Callbacks from this workspace carry <code>X-Flows-Signature: sha256=HMAC(secret, body)</code>. Put it in the
                  receiving app as <code>FLOWS_SIGNING_SECRET</code>. Also available at <code>GET /api/v1/signing-secret</code>.
                </p>
              </div>
              <WorkspaceSettingsForm
                id={ws.id}
                name={ws.name}
                allowedHosts={ws.allowedHosts}
                maxWorkflows={ws.maxWorkflows}
                maxConcurrentRuns={ws.maxConcurrentRuns}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
