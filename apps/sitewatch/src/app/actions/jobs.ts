'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { saveSchedule } from '@/lib/jobs/settings';
import { requireSession } from '@/lib/session';

const scheduleSchema = z.object({
  uptimePulseIntervalMinutes: z.number().int().min(1).max(1440),
  deepCrawlIntervalHours: z.number().int().min(1).max(168),
});

export async function updateSchedule(input: unknown) {
  await requireSession();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { error: 'Invalid schedule values' };

  await saveSchedule(parsed.data);
  revalidatePath('/jobs');
  return { error: null };
}
