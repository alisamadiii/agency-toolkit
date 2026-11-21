import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { clients } from '@/db/schema';

// Hostname without `www.`, so www.acme.com and acme.com are the same site.
export function siteHost(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Finds a site the user owns by id (uuid) or by domain/URL (www-insensitive).
export async function findSite(userId: string, idOrDomain: string) {
  if (/^[0-9a-f-]{36}$/i.test(idOrDomain)) {
    const [row] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, idOrDomain), eq(clients.userId, userId)));
    return row ?? null;
  }
  const host = siteHost(idOrDomain);
  if (!host) return null;
  const rows = await db.select().from(clients).where(eq(clients.userId, userId));
  return rows.find((c) => siteHost(c.baseUrl) === host) ?? null;
}
