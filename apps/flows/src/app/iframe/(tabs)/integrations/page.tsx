import { HubCard, HubCardHeader } from '@/components/hub/card';
import { IntegrationsCard } from '@/components/integrations-card';
import { integrationStatus } from '@/lib/integrations';
import { googleConfigured } from '@/lib/integrations/oauth';

import { embedPage } from '../../session';

export default async function IframeIntegrations() {
  const { ws } = await embedPage();
  const integrations = await integrationStatus(ws.id);
  return (
    <HubCard>
      <HubCardHeader
        title="Integrations"
        description="Connect your own accounts so workflows can use them, like booking meetings on your Google Calendar. Only this project can use them."
      />
      <div className="px-6 py-5">
        <IntegrationsCard workspaceId={ws.id} integrations={integrations} configured={googleConfigured()} />
      </div>
    </HubCard>
  );
}
