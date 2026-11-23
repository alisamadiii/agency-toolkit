import { NextResponse, type NextRequest } from 'next/server';

// Framing rules, applied at runtime (env can change without a rebuild):
// /iframe/** may only be framed by the client hub; everything else can't be framed at all.
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  if (req.nextUrl.pathname === '/iframe' || req.nextUrl.pathname.startsWith('/iframe/')) {
    const origins = (process.env.EMBED_ALLOWED_ORIGINS || 'https://app.alisamadii.com')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean);
    res.headers.set('content-security-policy', `frame-ancestors ${origins.join(' ')}`);
    // The start URL carries a ticket; never leak it to other sites.
    res.headers.set('referrer-policy', 'no-referrer');
  } else {
    res.headers.set('content-security-policy', "frame-ancestors 'none'");
    res.headers.set('x-frame-options', 'DENY');
  }
  res.headers.set('x-content-type-options', 'nosniff');
  return res;
}

export const config = {
  // Pages and API routes; skip Next's static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
