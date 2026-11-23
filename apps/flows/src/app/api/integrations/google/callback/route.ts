import type { NextRequest } from 'next/server';

import { finishConnect, IntegrationError } from '@/lib/integrations/oauth';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, text: string, ok: boolean, origin: string) {
  // Tell the Flows window that opened this popup (same origin only), then close.
  const script = ok
    ? `<script>try{window.opener&&window.opener.postMessage({source:'flows',type:'integration-connected'},${JSON.stringify(origin)})}catch(e){}setTimeout(function(){window.close()},1200)</script>`
    : '';
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="font-family:Inter,system-ui,sans-serif;background:#f7f6f4;color:#221f1c;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:380px;padding:24px;background:#fff;border:1px solid #e7e3de;border-radius:10px">
<p style="font-size:16px;font-weight:600;margin:0 0 6px">${esc(title)}</p>
<p style="font-size:14px;color:#6b6560;margin:0">${esc(text)}</p></div>${script}`,
    { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } }
  );
}

// Google redirects here after sign-in (in the popup).
export async function GET(req: NextRequest) {
  const origin = (process.env.PUBLIC_URL || req.nextUrl.origin).replace(/\/$/, '');
  const q = req.nextUrl.searchParams;
  if (q.get('error')) return page('Not connected', 'Google sign-in was cancelled. You can close this window.', false, origin);
  try {
    const { email } = await finishConnect(q.get('state') ?? '', q.get('code') ?? '');
    return page('Google Calendar connected', `Connected as ${email}. This window closes by itself.`, true, origin);
  } catch (error) {
    const message = error instanceof IntegrationError ? error.message : 'Something went wrong. Try connecting again.';
    if (!(error instanceof IntegrationError)) console.error('[integrations] callback failed', error);
    return page('Not connected', message, false, origin);
  }
}
