import { and, desc, eq, getTableColumns, ilike, ne, or, sql, type SQL } from 'drizzle-orm';

import { PageHeader } from '@/components/page-header';
import { db } from '@/db';
import { LEAD_STATUSES, leads, type LeadStatus } from '@/db/schema';
import { getSettings } from '@/lib/jobs/settings';

import { LeadSheet } from './lead-sheet';
import { LeadsTable } from './leads-table';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({ searchParams }: PageProps<'/leads'>) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const status = one(sp.status);
  const category = one(sp.category);
  const q = one(sp.q)?.trim();
  const selectedId = one(sp.lead);

  const where: SQL[] = [];
  if (status && LEAD_STATUSES.includes(status as LeadStatus)) {
    where.push(eq(leads.status, status as LeadStatus));
  } else {
    where.push(ne(leads.status, 'hidden'));
  }
  if (category) where.push(eq(leads.category, category));
  if (q) where.push(or(ilike(leads.name, `%${q}%`), ilike(leads.address, `%${q}%`))!);

  // The list never needs the heavy details JSON; only the open sheet does.
  const { details: _details, ...listColumns } = getTableColumns(leads);
  void _details;

  const [rows, settings, selected] = await Promise.all([
    db
      .select(listColumns)
      .from(leads)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(leads.firstSeenAt), desc(sql`${leads.reviewCount} * ${leads.rating}`))
      .limit(500),
    getSettings(),
    selectedId
      ? db.select().from(leads).where(eq(leads.placeId, selectedId)).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Leads"
        description={`${rows.length} lead${rows.length === 1 ? '' : 's'} · click a row for reviews, photos and status`}
      />
      <LeadsTable
        rows={rows}
        categories={settings.categories}
        filters={{ status: status ?? '', category: category ?? '', q: q ?? '' }}
      />
      <LeadSheet lead={selected} />
    </div>
  );
}
