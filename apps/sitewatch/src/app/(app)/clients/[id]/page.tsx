import { uptimeStats } from '@/lib/uptime-stats';

import { requireOwnedClient, endpointStatuses } from './_load';
import { UptimeDashboard } from './uptime-dashboard';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await requireOwnedClient(id);

  const [uptime, endpoints] = await Promise.all([
    uptimeStats(client),
    endpointStatuses(id, client.endpointChecks),
  ]);

  return (
    <UptimeDashboard
      status={client.uptimeStatus}
      sslValidTo={client.sslValidTo?.toISOString() ?? null}
      domainExpiry={client.domainExpiry?.toISOString() ?? null}
      uptime={uptime}
      endpoints={endpoints.map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        method: e.method,
        status: e.status,
        downReason: e.downReason,
      }))}
    />
  );
}
