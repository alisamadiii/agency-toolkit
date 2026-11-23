import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { FlowEditor } from '@/components/flow/flow-editor';
import { CHANNELS } from '@/lib/channels/registry';
import { integrationStatus } from '@/lib/integrations';
import { roleAtLeast } from '@/lib/embed';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

import { embedPage } from '../../session';
import { appUrl } from '@/lib/base-url';

// Canvas editor, edge to edge inside the hub's iframe.
export default async function IframeWorkflow({ params, searchParams }: PageProps<'/iframe/workflows/[wf]'>) {
  const { session, ws } = await embedPage();
  const { wf: wfId } = await params;
  const { run } = await searchParams;
  if (!isUuid(wfId)) notFound();
  // Scoped lookup: a workflow from another workspace is not found.
  const wf = await service.getWorkflow(ws.id, wfId).catch(() => null);
  if (!wf) notFound();
  const [schedules, runs, secrets, channels, integrations] = await Promise.all([
    service.listSchedules(ws.id, wfId),
    service.listRuns(ws.id, { workflowId: wfId, limit: 25 }),
    service.listSecrets(ws.id),
    service.listChannels(ws.id),
    integrationStatus(ws.id),
  ]);
  const h = await headers();
  const origin = appUrl() || `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  const fullAccess = roleAtLeast(session.role, 'full-access');

  return (
    <div className="fixed inset-0 bg-canvas">
      <FlowEditor
        workspaceId={ws.id}
        workspaceName="Automations"
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
        // Trigger URLs carry a secret token: full access only.
        triggerUrl={fullAccess ? `${origin}/api/hooks/${wf.id}/${wf.triggerToken}` : ''}
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
