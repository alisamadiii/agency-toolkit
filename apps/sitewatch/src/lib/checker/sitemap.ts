import type { FindingInput } from './types';

const FETCH_TIMEOUT = 20_000;
const MAX_SITEMAP_DEPTH = 3;
const MAX_URLS = 300;

export type SitemapResult = {
  urls: string[];
  lastmod: Map<string, string>;
  findings: FindingInput[];
};

export async function discoverPages(
  baseUrl: string,
  sitemapOverride: string | null
): Promise<SitemapResult> {
  const findings: FindingInput[] = [];
  const base = new URL(baseUrl);

  const candidates = sitemapOverride
    ? [sitemapOverride]
    : [
        ...(await sitemapsFromRobots(base)),
        new URL('/sitemap.xml', base).href,
        new URL('/sitemap_index.xml', base).href,
      ];

  const urls = new Map<string, string>(); // url -> lastmod ('' if none)
  let anySitemapLoaded = false;

  for (const candidate of dedupe(candidates)) {
    if (urls.size >= MAX_URLS) break;
    const ok = await collect(candidate, base, urls, 0);
    if (ok) anySitemapLoaded = true;
    if (anySitemapLoaded && urls.size > 0) break;
  }

  if (!anySitemapLoaded) {
    findings.push({
      checkType: 'sitemap',
      severity: 'error',
      pageUrl: baseUrl,
      message: 'No sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml all failed)',
      fingerKey: 'missing',
    });
  } else if (urls.size === 0) {
    findings.push({
      checkType: 'sitemap',
      severity: 'error',
      pageUrl: baseUrl,
      message: 'Sitemap exists but contains no page URLs',
      fingerKey: 'empty',
    });
  }

  // The homepage is always checked, sitemap or not.
  const home = base.href;
  if (!urls.has(home) && !urls.has(home.replace(/\/$/, ''))) {
    urls.set(home, '');
  }

  const lastmod = new Map<string, string>();
  for (const [url, mod] of urls) if (mod) lastmod.set(url, mod);

  return { urls: [...urls.keys()].slice(0, MAX_URLS), lastmod, findings };
}

async function sitemapsFromRobots(base: URL): Promise<string[]> {
  try {
    const res = await fetch(new URL('/robots.txt', base), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'user-agent': USER_AGENT },
    });
    if (!res.ok) return [];
    const text = await res.text();
    return text
      .split('\n')
      .map((line) => line.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
      .filter((u): u is string => Boolean(u));
  } catch {
    return [];
  }
}

// Returns true when the sitemap URL fetched and parsed as a sitemap.
async function collect(
  sitemapUrl: string,
  base: URL,
  out: Map<string, string>,
  depth: number
): Promise<boolean> {
  if (depth > MAX_SITEMAP_DEPTH || out.size >= MAX_URLS) return false;

  let xml: string;
  try {
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { 'user-agent': USER_AGENT },
    });
    if (!res.ok) return false;
    xml = await res.text();
  } catch {
    return false;
  }

  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) return false;

  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)];
  for (const [, entry] of entries) {
    const loc = entry.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    if (!loc || !sameSite(loc, base)) continue;
    const mod = entry.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1] ?? '';
    out.set(loc.trim(), mod.trim());
    if (out.size >= MAX_URLS) return true;
  }

  // Sitemap index: recurse into child sitemaps.
  const children = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)];
  for (const [, child] of children) {
    if (out.size >= MAX_URLS) break;
    await collect(child.trim(), base, out, depth + 1);
  }

  return true;
}

function sameSite(url: string, base: URL): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === base.hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

export const USER_AGENT =
  'WebsiteTracker/1.0 (+https://alisamadii.com; monitoring bot)';
