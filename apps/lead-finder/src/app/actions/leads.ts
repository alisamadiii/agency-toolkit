'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { LEAD_STATUSES, leads } from '@/db/schema';
import { refreshLeadDetails } from '@/lib/jobs/lead-finder';

const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  designReady: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export async function updateLead(placeId: string, patch: z.input<typeof patchSchema>) {
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success) return { error: 'Invalid update' };

  const data = { ...parsed.data };
  // Flipping design_ready on moves the lead along the pipeline too.
  if (data.designReady === true && !data.status) data.status = 'design_ready';

  await db
    .update(leads)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(leads.placeId, placeId));

  revalidatePath('/', 'layout');
  return { error: null };
}

export async function refreshDetails(placeId: string) {
  try {
    await refreshLeadDetails(placeId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Refresh failed' };
  }
  revalidatePath('/', 'layout');
  return { error: null };
}
