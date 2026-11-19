'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { user } from '@/db/schema';
import { generateApiKey } from '@/lib/api-key';
import { requireSession } from '@/lib/session';

// Rotates (or creates) the API key. The old key stops working immediately.
export async function regenerateApiKey() {
  const { user: sessionUser } = await requireSession();

  const key = generateApiKey();
  await db
    .update(user)
    .set({ apiKey: key, updatedAt: new Date() })
    .where(eq(user.id, sessionUser.id));

  revalidatePath('/account');
  return { error: null };
}
