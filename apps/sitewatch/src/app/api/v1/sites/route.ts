import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveApiUser, unauthorized } from '@/lib/api-key';
import { createClientSite } from '@/lib/clients';
import { summarizeSites } from '@/lib/site-summary';

export async function GET(request: NextRequest) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  const sites = await summarizeSites(user.id);
  return NextResponse.json({ sites });
}

const createSchema = z.object({ url: z.string().min(1) });

export async function POST(request: NextRequest) {
  const user = await resolveApiUser(request);
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { "url": "domain.com" }' }, { status: 400 });
  }

  const { error, client } = await createClientSite(user.id, parsed.data.url);
  if (error || !client) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json(
    {
      id: client.id,
      name: client.name,
      baseUrl: client.baseUrl,
      note: 'First check is running in the background.',
    },
    { status: 201 }
  );
}
