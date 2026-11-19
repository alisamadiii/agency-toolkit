// pnpm lead:status <place_id> <status|design-ready|not-design-ready>
// pnpm lead:refresh <place_id>
import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { LEAD_STATUSES, leads, type LeadStatus } from '@/db/schema';
import { refreshLeadDetails } from '@/lib/jobs/lead-finder';

async function main() {
  const [command, placeId, value] = process.argv.slice(2);
  if (!placeId) throw new Error('Missing place_id');

  const [lead] = await db.select().from(leads).where(eq(leads.placeId, placeId));
  if (!lead) throw new Error(`No lead with place_id ${placeId}`);

  if (command === 'refresh') {
    const details = await refreshLeadDetails(placeId);
    console.log(`Refreshed ${lead.name}: ${details.reviews?.length ?? 0} reviews, ${details.photos?.length ?? 0} photos`);
  } else if (command === 'status') {
    if (value === 'design-ready' || value === 'not-design-ready') {
      const ready = value === 'design-ready';
      await db
        .update(leads)
        .set({ designReady: ready, ...(ready ? { status: 'design_ready' as const } : {}), updatedAt: new Date() })
        .where(eq(leads.placeId, placeId));
    } else if (LEAD_STATUSES.includes(value as LeadStatus)) {
      await db
        .update(leads)
        .set({ status: value as LeadStatus, updatedAt: new Date() })
        .where(eq(leads.placeId, placeId));
    } else {
      throw new Error(`Status must be one of: ${LEAD_STATUSES.join(', ')}, design-ready, not-design-ready`);
    }
    console.log(`${lead.name} → ${value}`);
  } else {
    throw new Error('Usage: lead.ts status <place_id> <status> | refresh <place_id>');
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
