'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import {
  clients,
  incidents,
  type EndpointCheck,
  type FormConfig,
  type QuoteConfig,
} from '@/db/schema';
import { crawlClient } from '@/lib/checker/crawl';
import { createClientSite } from '@/lib/clients';
import { requireSession } from '@/lib/session';

export async function addClient(rawUrl: string) {
  const { user } = await requireSession();

  const { error, client } = await createClientSite(user.id, rawUrl);
  if (error || !client) return { error };

  revalidatePath('/');
  return { error: null, id: client.id };
}

const configSchema = z.object({
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  sitemapUrl: z.string().trim().url().nullable().optional(),
  criticalPaths: z.array(z.string().trim().min(1)).nullable().optional(),
  cdnHosts: z.array(z.string().trim().min(1)).nullable().optional(),
  formConfig: z
    .object({
      pageUrl: z.string().url(),
      fields: z.record(z.string(), z.string()),
      submitSelector: z.string().min(1),
      successSelector: z.string().min(1),
    })
    .nullable()
    .optional(),
  quoteConfig: z
    .object({
      endpoint: z.string().min(1),
      method: z.enum(['POST', 'PUT']),
      sampleBody: z.record(z.string(), z.unknown()),
      expectKeys: z.array(z.string()),
    })
    .nullable()
    .optional(),
  endpointChecks: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        url: z.string().trim().min(1),
        method: z.enum(['GET', 'POST', 'PUT']),
        body: z.string().nullable().optional(),
        expectStatus: z.number().int().nullable().optional(),
        expectKeys: z.array(z.string().trim().min(1)).nullable().optional(),
      })
    )
    .nullable()
    .optional(),
});

export async function updateClient(id: string, raw: unknown) {
  const { user } = await requireSession();

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  }

  await db
    .update(clients)
    .set({
      ...parsed.data,
      formConfig: parsed.data.formConfig as FormConfig | null | undefined,
      quoteConfig: parsed.data.quoteConfig as QuoteConfig | null | undefined,
      endpointChecks: parsed.data.endpointChecks as EndpointCheck[] | null | undefined,
    })
    .where(and(eq(clients.id, id), eq(clients.userId, user.id)));

  revalidatePath('/');
  revalidatePath(`/clients/${id}`);
  return { error: null };
}

export async function deleteClient(id: string) {
  const { user } = await requireSession();
  await db.delete(clients).where(and(eq(clients.id, id), eq(clients.userId, user.id)));
  revalidatePath('/');
  return { error: null };
}

export async function runNow(id: string) {
  const { user } = await requireSession();
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.userId, user.id)));
  if (!client) return { error: 'Website not found' };

  // Fire-and-forget: a full crawl can take minutes, the run shows up in the
  // dashboard as "running" right away.
  void crawlClient(client).catch((error) =>
    console.error(`[clients] manual crawl of ${client.baseUrl} failed`, error)
  );

  revalidatePath('/');
  revalidatePath(`/clients/${id}`);
  return { error: null };
}

// Looks up an incident the caller owns (via its client), returning the
// client id + fingerprint, or null if not found / not theirs.
async function ownedIncident(incidentId: string, userId: string) {
  const [row] = await db
    .select({ clientId: incidents.clientId, fingerprint: incidents.fingerprint })
    .from(incidents)
    .innerJoin(clients, eq(incidents.clientId, clients.id))
    .where(and(eq(incidents.id, incidentId), eq(clients.userId, userId)));
  return row ?? null;
}

// Mute a problem: hides it from the active list and stops it alerting, even if
// it flaps (reconcileIncidents keeps the mute sticky per fingerprint).
export async function ignoreIncident(incidentId: string) {
  const { user } = await requireSession();
  const owned = await ownedIncident(incidentId, user.id);
  if (!owned) return { error: 'Problem not found' };

  await db.update(incidents).set({ ignoredAt: new Date() }).where(eq(incidents.id, incidentId));

  revalidatePath('/');
  revalidatePath(`/clients/${owned.clientId}`);
  return { error: null };
}

// Un-mute a problem. Clears the flag on EVERY row sharing the fingerprint so a
// stale resolved sibling can't silently re-mute it on the next reopen.
export async function unignoreIncident(incidentId: string) {
  const { user } = await requireSession();
  const owned = await ownedIncident(incidentId, user.id);
  if (!owned) return { error: 'Problem not found' };

  await db
    .update(incidents)
    .set({ ignoredAt: null })
    .where(
      and(eq(incidents.clientId, owned.clientId), eq(incidents.fingerprint, owned.fingerprint))
    );

  revalidatePath('/');
  revalidatePath(`/clients/${owned.clientId}`);
  return { error: null };
}

function prettyName(hostname: string): string {
  const core = hostname.replace(/^www\./, '').split('.')[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}
