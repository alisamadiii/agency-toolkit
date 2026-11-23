import { ApiKeys, Secrets } from '@/components/dashboard-forms';
import { HubCard, HubCardHeader } from '@/components/hub/card';
import { roleAtLeast } from '@/lib/embed';
import * as service from '@/lib/service';

import { embedPage } from '../../session';

export default async function IframeKeys() {
  const { session, ws } = await embedPage();
  const fullAccess = roleAtLeast(session.role, 'full-access');
  const [secrets, keys] = await Promise.all([service.listSecrets(ws.id), fullAccess ? service.listApiKeys(ws.id) : []]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <HubCard>
        <HubCardHeader
          title="Secrets"
          description={
            <>
              Encrypted values for your workflows, used as <code className="font-mono">{'{{secrets.NAME}}'}</code>. Values are
              never shown again.
            </>
          }
        />
        <div className="px-6 py-5">
          <Secrets workspaceId={ws.id} names={secrets.map((s) => s.name)} />
        </div>
      </HubCard>
      {fullAccess && (
        <HubCard>
          <HubCardHeader title="API keys" description="Let your own apps start workflows and read runs. Each key only reaches this project." />
          <div className="px-6 py-5">
            <ApiKeys workspaceId={ws.id} keys={keys} path="/iframe/keys" />
          </div>
        </HubCard>
      )}
    </div>
  );
}
