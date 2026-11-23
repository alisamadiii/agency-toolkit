import type { NextRequest } from 'next/server';

import { readEmbed } from '@/lib/embed';

// The hub reopens Automations with ?w=<workspace id> instead of a new ticket. `w` grants
// nothing: it only has to match the workspace the existing session cookie is pinned to.
// No session, or a session for another project → the expired page, which asks the hub
// for a fresh one-time link.
export async function GET(req: NextRequest) {
  const session = await readEmbed();
  const wanted = req.nextUrl.searchParams.get('w');
  const ok = session && wanted && session.workspaceId === wanted;
  return new Response(null, {
    status: 303,
    headers: { location: ok ? '/iframe' : '/iframe/expired', 'cache-control': 'no-store' },
  });
}
