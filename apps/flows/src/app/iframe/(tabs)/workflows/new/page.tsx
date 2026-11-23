import { redirect } from 'next/navigation';

import { NewWorkflowForm } from '@/components/flow/new-workflow-form';
import { roleAtLeast } from '@/lib/embed';

import { embedPage } from '../../../session';

export default async function IframeNewWorkflow() {
  const { session, ws } = await embedPage();
  if (!roleAtLeast(session.role, 'content-editor')) redirect('/iframe');
  return (
    <div className="max-w-lg">
      <NewWorkflowForm workspaceId={ws.id} hasHttpbin={ws.allowedHosts.includes('httpbin.org') || ws.allowedHosts.includes('*')} />
    </div>
  );
}
