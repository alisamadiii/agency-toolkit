import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NewWorkflowForm } from '@/components/flow/new-workflow-form';
import { integrationStatus } from '@/lib/integrations';
import * as service from '@/lib/service';
import { isUuid } from '@/lib/utils';

export default async function NewWorkflowPage({ params }: PageProps<'/w/[id]/workflows/new'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ws = await service.getWorkspace(id).catch(() => null);
  if (!ws) notFound();

  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <div>
        <Link href={`/w/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {ws.name}
        </Link>
        <h1 className="text-2xl font-semibold">New workflow</h1>
        <p className="text-sm text-muted-foreground">
          Opens on a canvas. Drag in HTTP, Code and IF nodes and connect them. Add a schedule on the trigger to make it a cron job.
        </p>
      </div>
      <NewWorkflowForm
        workspaceId={id}
        hasCalendar={(await integrationStatus(id)).some((i) => i.provider === 'google_calendar' && i.connected)}
        hasHttpbin={ws.allowedHosts.includes('httpbin.org') || ws.allowedHosts.includes('*')} />
    </div>
  );
}
