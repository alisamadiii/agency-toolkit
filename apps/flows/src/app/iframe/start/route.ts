import type { NextRequest } from 'next/server';

import { EMBED_COOKIE, embedAllowedOrigins, encodeSession, redeemTicket, sessionCookieOptions } from '@/lib/embed';

const expired = () => {
  // Tell the hub (only the allowed origins) to fetch a fresh link.
  const notify = embedAllowedOrigins()
    .map((o) => `try{parent.postMessage({source:'flows',type:'session-expired'},${JSON.stringify(o)})}catch(e){}`)
    .join('');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link expired</title>
<body style="font-family:Inter,system-ui,sans-serif;background:#f7f6f4;color:#221f1c;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:360px;padding:24px">
<p style="font-size:16px;font-weight:600;margin:0 0 6px">This link has expired</p>
<p style="font-size:14px;color:#6b6560;margin:0">Reload the page to open Automations again.</p></div>
<script>${notify}</script>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
};

// Trades a one-time ticket from the hub for a session cookie pinned to one workspace.
export async function GET(req: NextRequest) {
  // When the browser says where the request came from, it must be the hub.
  // (No referer is allowed: frame-ancestors still stops anyone else from framing it.)
  const referer = req.headers.get('referer');
  if (referer) {
    let origin = '';
    try {
      origin = new URL(referer).origin;
    } catch {
      return expired();
    }
    if (origin !== req.nextUrl.origin && !embedAllowedOrigins().includes(origin)) return expired();
  }

  const ticket = await redeemTicket(req.nextUrl.searchParams.get('ticket') ?? '');
  if (!ticket) return expired();

  const { value, expires } = encodeSession({
    workspaceId: ticket.workspaceId,
    role: ticket.role,
    email: ticket.user.email ?? '',
    name: ticket.user.name ?? '',
  });
  const res = new Response(null, {
    status: 303,
    headers: { location: '/iframe', 'cache-control': 'no-store' },
  });
  const o = sessionCookieOptions(expires);
  res.headers.append(
    'set-cookie',
    `${EMBED_COOKIE}=${value}; Path=${o.path}; Expires=${o.expires.toUTCString()}; HttpOnly; Secure; SameSite=None; Partitioned`
  );
  return res;
}
