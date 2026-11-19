import { requireOwnedClient, endpointStatuses } from '../_load';
import { EndpointsView } from '../_components/endpoints-view';

export default async function EndpointsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await requireOwnedClient(id);
  const endpoints = await endpointStatuses(client.id, client.endpointChecks);

  return <EndpointsView clientId={client.id} endpoints={endpoints} />;
}
