'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { settings } from '@/db/schema';
import { isRunInProgress, runLeadFinder, type RunSummary } from '@/lib/jobs/lead-finder';
import { getSettings } from '@/lib/jobs/settings';
import { isValidTimeZone } from '@/lib/time';

const settingsSchema = z.object({
  enabled: z.boolean(),
  runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm'),
  timezone: z.string().refine(isValidTimeZone, 'Unknown timezone'),
  homeLat: z.coerce.number().min(-90).max(90),
  homeLng: z.coerce.number().min(-180).max(180),
  radiusMiles: z.coerce.number().min(1).max(50),
  minRating: z.coerce.number().min(1).max(5),
  minReviews: z.coerce.number().int().min(0),
  dailyLimit: z.coerce.number().int().min(1).max(25),
  categories: z.array(z.string().trim().min(1)).min(1, 'Add at least one category'),
  maxApiCallsPerRun: z.coerce.number().int().min(5).max(500),
});

export type SettingsInput = z.input<typeof settingsSchema>;

export async function saveSettings(input: SettingsInput) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  if (parsed.data.maxApiCallsPerRun <= parsed.data.dailyLimit) {
    return { error: 'Max API calls must be larger than the daily limit' };
  }

  await getSettings(); // make sure the row exists
  await db
    .update(settings)
    .set({
      ...parsed.data,
      categories: [...new Set(parsed.data.categories.map((c) => c.toLowerCase()))],
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 'global'));

  revalidatePath('/', 'layout');
  return { error: null };
}

// Starts a real run in the background; the Runs page shows progress.
export async function runNow() {
  if (await isRunInProgress()) return { error: 'A run is already in progress' };
  void runLeadFinder({ trigger: 'manual' })
    .catch((e) => console.error('[run-now]', e))
    .finally(() => revalidatePath('/', 'layout'));
  return { error: null };
}

export async function dryRun(): Promise<{ error: string | null; summary?: RunSummary }> {
  try {
    const summary = await runLeadFinder({ trigger: 'manual', dryRun: true });
    return { error: null, summary };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Dry run failed' };
  }
}
