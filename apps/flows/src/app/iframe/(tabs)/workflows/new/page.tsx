import { redirect } from 'next/navigation';

import { NewWorkflowForm } from '@/components/flow/new-workflow-form';
import { integrationStatus } from '@/lib/integrations';
import { roleAtLeast } from '@/lib/embed';

import { embedPage } from '../../../session';

export default async function IframeNewWorkflow() {
  const { session, ws } = await embedPage();
  if (!roleAtLeast(session.role, 'content-editor')) redirect('/iframe');
  return (
    <div className="max-w-lg">
      <NewWorkflowForm
        workspaceId={ws.id}
        hasCalendar={(await integrationStatus(ws.id)).some((i) => i.provider === 'google_calendar' && i.connected)}
        hasHttpbin={ws.allowedHosts.includes('httpbin.org') || ws.allowedHosts.includes('*')} />
    </div>
  );
}
