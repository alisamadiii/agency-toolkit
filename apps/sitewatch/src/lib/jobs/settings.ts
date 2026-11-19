import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { settings, type Settings } from '@/db/schema';

const GLOBAL = 'global';

// The singleton settings row, created with defaults on first access.
export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, GLOBAL));
  if (row) return row;

  const [created] = await db
    .insert(settings)
    .values({ id: GLOBAL })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost an insert race — read the winner.
  const [existing] = await db.select().from(settings).where(eq(settings.id, GLOBAL));
  return existing;
}

export async function saveSchedule(input: {
  uptimePulseIntervalMinutes: number;
  deepCrawlIntervalHours: number;
}) {
  await db
    .insert(settings)
    .values({ id: GLOBAL, ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...input, updatedAt: new Date() },
    });
}
