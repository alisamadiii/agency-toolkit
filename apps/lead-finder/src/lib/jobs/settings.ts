import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { settings, type Settings } from '@/db/schema';

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 'global'));
  if (row) return row;
  const [created] = await db
    .insert(settings)
    .values({ id: 'global' })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getSettings());
}

// The grid only needs reseeding when one of these inputs changes.
export function cellsHash(s: Pick<Settings, 'homeLat' | 'homeLng' | 'radiusMiles' | 'categories'>) {
  return createHash('sha1')
    .update(JSON.stringify([s.homeLat, s.homeLng, s.radiusMiles, [...s.categories].sort()]))
    .digest('hex');
}
