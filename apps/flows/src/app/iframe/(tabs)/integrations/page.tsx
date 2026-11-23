import { HubCard, HubCardHeader } from '@/components/hub/card';
import { IntegrationsCard } from '@/components/integrations-card';
import { embedAllowedOrigins } from '@/lib/embed';
import { integrationStatus } from '@/lib/integrations';

import { embedPage } from '../../session';

export default async function IframeIntegrations() {
  const { ws } = await embedPage();
  const integrations = await integrationStatus(ws.id);
  return (
    <HubCard>
      <HubCardHeader
        title="Integrations"
        description="Apps this project connected in the client hub, like Google Calendar. Workflows use them to book meetings and find free time."
      />
      <div className="px-6 py-5">
        <IntegrationsCard integrations={integrations} hubOrigins={embedAllowedOrigins()} />
      </div>
    </HubCard>
  );
}
