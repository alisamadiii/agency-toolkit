import { ChannelsCard } from '@/components/channels-card';
import { HubCard, HubCardHeader } from '@/components/hub/card';
import * as service from '@/lib/service';

import { embedPage } from '../../session';

export default async function IframeNotifications() {
  const { ws } = await embedPage();
  const channels = await service.listChannels(ws.id);
  return (
    <HubCard>
      <HubCardHeader
        title="Notification channels"
        description="Where your workflows send messages and run alerts: Slack, email, SMS, WhatsApp and more. Only this project can use them."
      />
      <div className="px-6 py-5">
        <ChannelsCard workspaceId={ws.id} channels={channels} />
      </div>
    </HubCard>
  );
}
