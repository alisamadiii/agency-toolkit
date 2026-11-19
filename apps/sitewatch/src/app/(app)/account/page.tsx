import { and, count, eq, gte, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { clients, incidents, runs, user } from '@/db/schema';
import { ensureApiKey } from '@/lib/api-key';
import { requireSession } from '@/lib/session';

import { AccountClient } from './account-client';

export default async function AccountPage() {
  const { user: sessionUser } = await requireSession();

  const apiKey = await ensureApiKey(sessionUser.id);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const [[userRow], [siteCount], [incidentCount], [runCount]] = await Promise.all([
    db.select().from(user).where(eq(user.id, sessionUser.id)),
    db
      .select({ value: count() })
      .from(clients)
      .where(eq(clients.userId, sessionUser.id)),
    db
      .select({ value: count() })
      .from(incidents)
      .innerJoin(clients, eq(incidents.clientId, clients.id))
      .where(and(eq(clients.userId, sessionUser.id), isNull(incidents.resolvedAt))),
    db
      .select({ value: count() })
      .from(runs)
      .innerJoin(clients, eq(runs.clientId, clients.id))
      .where(and(eq(clients.userId, sessionUser.id), gte(runs.startedAt, thirtyDaysAgo))),
  ]);

  return (
    <AccountClient
      profile={{
        name: userRow.name,
        email: userRow.email,
        role: userRow.role,
        createdAt: userRow.createdAt.toISOString().slice(0, 10),
      }}
      apiKey={apiKey}
      counts={{
        sites: siteCount.value,
        openIncidents: incidentCount.value,
        runs30d: runCount.value,
      }}
    />
  );
}
