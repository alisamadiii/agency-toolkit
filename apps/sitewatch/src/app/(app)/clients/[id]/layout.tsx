import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { runs } from '@/db/schema';

import { requireOwnedClient } from './_load';
import { DomainHeader } from './_components/domain-header';
import { DomainNav } from './_components/domain-nav';

export default async function ClientLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const client = await requireOwnedClient(id);

  // Is a crawl in flight? Drives the header's "Checking…" indicator.
  const [runningRun] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.clientId, client.id), eq(runs.status, 'running')))
    .limit(1);

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <DomainNav id={client.id} name={client.name} />
      <div className="min-w-0 flex-1 space-y-6">
        <DomainHeader
          checkRunning={Boolean(runningRun)}
          client={{
            id: client.id,
            name: client.name,
            baseUrl: client.baseUrl,
            enabled: client.enabled,
            sitemapUrl: client.sitemapUrl,
            criticalPaths: client.criticalPaths,
            cdnHosts: client.cdnHosts,
          }}
        />
        {children}
      </div>
    </div>
  );
}
