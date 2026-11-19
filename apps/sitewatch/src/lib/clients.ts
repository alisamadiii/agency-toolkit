import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { clients } from '@/db/schema';
import { crawlClient } from '@/lib/checker/crawl';

const urlSchema = z
  .string()
  .trim()
  .min(1, 'Enter a URL')
  .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`))
  .pipe(z.string().url('Not a valid URL'));

// Shared by the Add-website dialog action and POST /api/v1/sites: normalize
// the URL, insert, and fire the first crawl in the background.
export async function createClientSite(userId: string, rawUrl: string) {
  const parsed = urlSchema.safeParse(rawUrl);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid URL', client: null };
  }

  const url = new URL(parsed.data);
  const baseUrl = `${url.protocol}//${url.hostname}`;
  const name = prettyName(url.hostname);

  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.userId, userId), eq(clients.baseUrl, baseUrl)));
  if (existing) return { error: 'This website is already being monitored', client: null };

  const [client] = await db
    .insert(clients)
    .values({ userId, name, baseUrl })
    .returning();

  void crawlClient(client).catch((error) =>
    console.error(`[clients] initial crawl of ${baseUrl} failed`, error)
  );

  return { error: null, client };
}

function prettyName(hostname: string): string {
  const core = hostname.replace(/^www\./, '').split('.')[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}
