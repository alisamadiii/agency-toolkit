import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@/db';
import { user } from '@/db/schema';

export function generateApiKey(): string {
  return `wt_${randomBytes(24).toString('hex')}`;
}

// Key comes from the x-api-key header or ?api_key= query. Returns the owning
// user row, or null when missing/unknown.
export async function resolveApiUser(request: NextRequest) {
  const key =
    request.headers.get('x-api-key') ??
    request.nextUrl.searchParams.get('api_key') ??
    '';
  if (!key) return null;

  const [row] = await db.select().from(user).where(eq(user.apiKey, key));
  return row ?? null;
}

// Lazily creates the key on first Account-page visit (server-side only —
// deliberately NOT a server action, so it can't be invoked from the client).
export async function ensureApiKey(userId: string): Promise<string> {
  const [row] = await db
    .select({ apiKey: user.apiKey })
    .from(user)
    .where(eq(user.id, userId));
  if (row?.apiKey) return row.apiKey;

  const key = generateApiKey();
  await db.update(user).set({ apiKey: key }).where(eq(user.id, userId));
  return key;
}

export function unauthorized() {
  return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
}
