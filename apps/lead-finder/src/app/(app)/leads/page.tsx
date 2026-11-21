import { and, asc, eq, getTableColumns, ilike, ne, or, sql, type SQL } from 'drizzle-orm';

import { PageHeader } from '@/components/page-header';
import { db } from '@/db';
import { LEAD_STATUSES, leads, type LeadStatus } from '@/db/schema';
import { homePoint, milesFromHome } from '@/lib/distance-sql';
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

  const settings = await getSettings();
  // Live miles from the current home point; the stored distance_miles goes stale when home moves.
  const miles = milesFromHome(homePoint(settings));

  const [rows, selected] = await Promise.all([
    db
      .select({ ...listColumns, distanceMiles: miles })
      .from(leads)
      .where(where.length ? and(...where) : undefined)
      // Nearest to home first; ties go to the stronger lead (review_count * rating).
      .orderBy(asc(miles), sql`${leads.reviewCount} * ${leads.rating} desc nulls last`)
      .limit(500),
    selectedId
      ? db
          .select({ ...getTableColumns(leads), distanceMiles: miles })
          .from(leads)
          .where(eq(leads.placeId, selectedId))
          .then((r) => r[0] ?? null)
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
