import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { incidents } from '@/db/schema';
import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { findSite } from '@/lib/site-lookup';

type Params = { params: Promise<{ site: string; incidentId: string }> };

// The incident, only when it belongs to this site and the site to this user.
async function load(request: NextRequest, { params }: Params) {
  const user = await resolveApiUser(request);
  if (!user) return { response: unauthorized() };

  const { site, incidentId } = await params;
  const client = await findSite(user.id, decodeURIComponent(site));
  const [incident] = client && /^[0-9a-f-]{36}$/i.test(incidentId)
    ? await db
        .select({ id: incidents.id, fingerprint: incidents.fingerprint })
        .from(incidents)
        .where(and(eq(incidents.id, incidentId), eq(incidents.clientId, client.id)))
    : [];
  if (!client || !incident) {
    return { response: NextResponse.json({ error: 'Problem not found' }, { status: 404 }) };
  }
  return { client, incident };
}

// Mute: hides the problem and stops it alerting (sticky per fingerprint).
export async function POST(request: NextRequest, ctx: Params) {
  const found = await load(request, ctx);
  if ('response' in found) return found.response;

  await db.update(incidents).set({ ignoredAt: new Date() }).where(eq(incidents.id, found.incident.id));
  return NextResponse.json({ ok: true });
}

// Un-mute: clears every row sharing the fingerprint, like unignoreIncident.
export async function DELETE(request: NextRequest, ctx: Params) {
  const found = await load(request, ctx);
  if ('response' in found) return found.response;

  await db
    .update(incidents)
    .set({ ignoredAt: null })
    .where(
      and(
        eq(incidents.clientId, found.client.id),
        eq(incidents.fingerprint, found.incident.fingerprint)
      )
    );
  return NextResponse.json({ ok: true });
}
