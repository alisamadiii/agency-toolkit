import { env } from '@/env';

// Proxies Places photo media so the API key never reaches the browser.
// /api/photo/places/{placeId}/photos/{photoRef}?w=600
export async function GET(req: Request, ctx: RouteContext<'/api/photo/[...name]'>) {
  const { name } = await ctx.params;
  const path = name.join('/');
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(path)) {
    return new Response('Bad photo name', { status: 400 });
  }
  const width = Math.min(Number(new URL(req.url).searchParams.get('w')) || 600, 1600);

  const res = await fetch(
    `https://places.googleapis.com/v1/${path}/media?maxWidthPx=${width}`,
    { headers: { 'X-Goog-Api-Key': env().GOOGLE_MAPS_API_KEY }, redirect: 'follow' }
  );
  if (!res.ok || !res.body) return new Response('Photo unavailable', { status: 502 });

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
