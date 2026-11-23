import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { FlowEditor } from '@/components/flow/flow-editor';
import { CHANNELS } from '@/lib/channels/registry';
import { integrationStatus } from '@/lib/integrations';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

export default async function WorkflowPage({ params, searchParams }: PageProps<'/w/[id]/workflows/[wf]'>) {
  const { id, wf: wfId } = await params;
  const { run } = await searchParams;
  if (!isUuid(id) || !isUuid(wfId)) notFound();
  const wf = await service.getWorkflow(id, wfId).catch(() => null);
  if (!wf) notFound();
  const [ws, schedules, runs, secrets, channels, integrations] = await Promise.all([
    service.getWorkspace(id),
    service.listSchedules(id, wfId),
    service.listRuns(id, { workflowId: wfId, limit: 25 }),
    service.listSecrets(id),
    service.listChannels(id),
    integrationStatus(id),
  ]);

  const h = await headers();
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, '') || `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;

  return (
    // Full screen over the app header: the editor toolbar has its own back link.
    <div className="fixed inset-0 z-40 bg-background">
      <FlowEditor
        workspaceId={id}
        workspaceName={ws.name}
        workflow={{
          id: wf.id,
          name: wf.name,
          enabled: wf.enabled,
          description: wf.description,
          timeoutSec: wf.timeoutSec,
          maxAttempts: wf.maxAttempts,
          onFinishUrl: wf.onFinishUrl,
          alertOn: wf.alertOn,
          alertChannelIds: wf.alertChannelIds,
          graph: wf.graph,
        }}
        triggerUrl={`${origin}/api/hooks/${wf.id}/${wf.triggerToken}`}
        schedules={schedules}
        secretNames={secrets.map((s) => s.name)}
        channels={channels.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          enabled: c.enabled,
          recipient: CHANNELS[c.type].recipient !== null,
        }))}
        integrations={integrations.map((i) => ({
          provider: i.provider,
          label: i.label,
          connected: i.connected,
          accountEmail: i.accountEmail,
        }))}
        runs={runs.data}
        initialRunId={typeof run === 'string' ? run : (runs.data[0]?.id ?? null)}
      />
    </div>
  );
}
