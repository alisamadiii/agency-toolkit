import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { clients } from '@/db/schema';
import { requireSession } from '@/lib/session';

// Loads the client row the signed-in user owns, or 404s. Shared by the
// per-domain layout and every sub-page so each verifies ownership itself.
export async function requireOwnedClient(id: string) {
  const { user } = await requireSession();
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.userId, user.id)));
  if (!client) notFound();
  return client;
}

export { endpointStatuses, type EndpointStatus, type EndpointWithStatus } from '@/lib/endpoint-status';
