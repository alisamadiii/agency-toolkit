import path from 'node:path';

import type { Page, Response } from 'playwright';

import type { FindingInput } from './types';

const PAGE_TIMEOUT = 30_000;
const SLOW_PAGE_MS = 3_000;
const MAX_ELEMENT_SHOTS = 10;

export type PageCheckOptions = {
  cdnHosts: string[] | null;
  baseHost: string;
  // When set, findings that point at a DOM element get a clipped screenshot
  // of that element saved here (shown in the dashboard's Locate dialog).
  shotsDir?: string;
};

export type PageCheckResult = {
  findings: FindingInput[];
  loadMs: number;
  status: number | null;
  externalLinks: string[];
};

// Everything we can learn from one rendered page. The page object must be a
// fresh tab; listeners are attached before navigation.
export async function checkPage(
  page: Page,
  url: string,
  opts: PageCheckOptions
): Promise<PageCheckResult> {
  const findings: FindingInput[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: { url: string; status: number | null; reason: string }[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText ?? 'failed';
    // ERR_ABORTED is the browser cancelling its own speculative/media loads
    // (prefetch, paused videos) — not a broken asset.
    if (reason === 'net::ERR_ABORTED') return;
    failedRequests.push({ url: req.url(), status: null, reason });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ url: res.url(), status: res.status(), reason: `HTTP ${res.status()}` });
    }
  });

  const started = Date.now();
  let response: Response | null = null;
  try {
    response = await page.goto(url, {
      waitUntil: 'load',
      timeout: PAGE_TIMEOUT,
    });
  } catch (error) {
    findings.push({
      checkType: 'http_status',
      severity: 'error',
      pageUrl: url,
      message: 'Page failed to load',
      fingerKey: 'load',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return { findings, loadMs: Date.now() - started, status: null, externalLinks: [] };
  }
  // Let lazy content settle; never fail on a chatty page that won't go idle.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  const loadMs = Date.now() - started;

  // Scroll through the page so loading="lazy" images actually load, then
  // return to the top (the covered-button check uses viewport coordinates).
  await autoScroll(page);

  const status = response?.status() ?? null;
  if (status && status >= 400) {
    findings.push({
      checkType: 'http_status',
      severity: 'error',
      pageUrl: url,
      message: `Page responded with HTTP ${status}`,
      fingerKey: 'status',
      details: { status },
    });
    return { findings, loadMs, status, externalLinks: [] };
  }

  if (loadMs > SLOW_PAGE_MS) {
    findings.push({
      checkType: 'perf',
      severity: 'warning',
      pageUrl: url,
      message: `Page took longer than ${SLOW_PAGE_MS / 1000}s to load`,
      fingerKey: 'slow',
      details: { loadMs },
    });
  }

  const pageIsHttps = url.startsWith('https://');
  const snapshot = await inspectDom(page);

  // --- images ---
  for (const img of snapshot.images) {
    if (img.visible && !img.loaded) {
      findings.push({
        checkType: 'image_broken',
        severity: 'error',
        pageUrl: url,
        message: `Image failed to render: ${shorten(img.src)}`,
        fingerKey: img.src,
        details: { src: img.src, selector: img.selector },
      });
    }
    if (opts.cdnHosts?.length && img.src.startsWith('http')) {
      const host = hostnameOf(img.src);
      const ownSite = host === opts.baseHost || host === `www.${opts.baseHost}`;
      if (host && !ownSite && !opts.cdnHosts.includes(host)) {
        findings.push({
          checkType: 'image_not_cdn',
          severity: 'error',
          pageUrl: url,
          message: `Image not served from an approved CDN: ${shorten(img.src)}`,
          fingerKey: img.src,
          details: { src: img.src, host, allowed: opts.cdnHosts, selector: img.selector },
        });
      }
    }
  }
  const missingAlt = snapshot.images.filter((i) => i.visible && !i.alt).length;
  if (missingAlt > 0) {
    findings.push({
      checkType: 'seo',
      severity: 'warning',
      pageUrl: url,
      message: 'Images without alt text',
      fingerKey: 'img-alt',
      details: { count: missingAlt },
    });
  }

  // --- failed network requests (CDN assets, scripts, styles, fonts) ---
  for (const req of dedupeBy(failedRequests, (r) => r.url).slice(0, 20)) {
    if (req.url === url) continue;
    if (isIgnorableAsset(req.url)) continue;
    findings.push({
      checkType: 'asset_failed',
      severity: 'error',
      pageUrl: url,
      message: `Asset failed to load (${req.reason}): ${shorten(req.url)}`,
      fingerKey: req.url,
      details: req,
    });
  }

  // --- mixed content ---
  if (pageIsHttps) {
    for (const insecure of snapshot.httpAssets.slice(0, 10)) {
      findings.push({
        checkType: 'mixed_content',
        severity: 'error',
        pageUrl: url,
        message: `Insecure http:// asset on https page: ${shorten(insecure)}`,
        fingerKey: insecure,
        details: { src: insecure },
      });
    }
  }

  // --- buttons ---
  for (const btn of snapshot.deadButtons.slice(0, 10)) {
    findings.push({
      checkType: 'button_dead',
      severity: btn.reason === 'covered' ? 'error' : 'warning',
      pageUrl: url,
      message: `Button "${btn.label}" ${btn.reason === 'covered' ? 'is covered by another element' : 'has no action (empty or # link)'}`,
      fingerKey: `${btn.label}|${btn.reason}`,
      details: btn,
    });
  }

  // --- console errors ---
  const realErrors = dedupeBy(
    consoleErrors.filter((e) => !isIgnorableConsole(e)),
    (e) => e
  );
  if (realErrors.length > 0) {
    findings.push({
      checkType: 'console_error',
      severity: 'warning',
      pageUrl: url,
      message: 'JavaScript console errors on page',
      fingerKey: 'console',
      details: { errors: realErrors.slice(0, 10) },
    });
  }

  // --- SEO ---
  findings.push(...seoFindings(url, snapshot));

  // --- structured data ---
  for (let i = 0; i < snapshot.jsonLd.length; i++) {
    try {
      JSON.parse(snapshot.jsonLd[i]);
    } catch {
      findings.push({
        checkType: 'structured_data',
        severity: 'warning',
        pageUrl: url,
        message: 'JSON-LD block is not valid JSON',
        fingerKey: `jsonld-${i}`,
      });
    }
  }

  // --- stale copyright ---
  const year = new Date().getFullYear();
  if (snapshot.copyrightYears.length > 0) {
    const newest = Math.max(...snapshot.copyrightYears);
    if (newest < year) {
      findings.push({
        checkType: 'stale_content',
        severity: 'warning',
        pageUrl: url,
        message: `Copyright year in footer is ${newest} (current year is ${year})`,
        fingerKey: 'copyright',
        details: { found: newest, current: year },
      });
    }
  }

  if (opts.shotsDir) {
    await captureElementShots(page, url, findings, opts.shotsDir);
  }

  return { findings, loadMs, status, externalLinks: snapshot.externalLinks };
}

// Clipped screenshot of each element-bound finding, saved next to the run's
// page screenshots. Best-effort: a selector that no longer matches is skipped.
async function captureElementShots(
  page: Page,
  url: string,
  findings: FindingInput[],
  shotsDir: string
) {
  const slug = fileSafe(url);
  let count = 0;
  for (const finding of findings) {
    if (count >= MAX_ELEMENT_SHOTS) break;
    const selector = finding.details?.selector;
    if (typeof selector !== 'string' || !selector) continue;
    const file = `el-${slug}-${count}.png`;
    try {
      await page
        .locator(selector)
        .first()
        .screenshot({ path: path.join(shotsDir, file), timeout: 3_000 });
      finding.details = { ...finding.details, screenshot: file };
      count += 1;
    } catch {
      // element gone, zero-sized or ambiguous — no shot
    }
  }
}

function fileSafe(url: string): string {
  try {
    const u = new URL(url);
    const slug = (u.pathname === '/' ? 'home' : u.pathname)
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    return (slug || 'home').slice(0, 60);
  } catch {
    return 'page';
  }
}

async function autoScroll(page: Page) {
  try {
    await page.evaluate(async () => {
      const step = innerHeight;
      const limit = Math.min(document.body.scrollHeight, step * 20);
      for (let y = 0; y < limit; y += step) {
        scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      scrollTo(0, 0);
    });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(300);
  } catch {
    // scrolling is best-effort
  }
}

type DomSnapshot = Awaited<ReturnType<typeof inspectDom>>;

function inspectDom(page: Page) {
  return page.evaluate(() => {
    // Ancestor-aware visibility: checkVisibility covers display/visibility/
    // opacity of the whole chain (own-style checks miss popups hidden via a
    // parent). aria-hidden subtrees (closed modals, offcanvas menus) and
    // zero-size boxes are also out.
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      if (typeof (el as HTMLElement).checkVisibility === 'function') {
        return (el as HTMLElement).checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      }
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    // Short, stable CSS selector for pointing a human (or AI) at the element.
    const cssPath = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        if (node.id) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        let sel = node.tagName.toLowerCase();
        sel += [...node.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
        const parent: Element | null = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((s) => s.tagName === node!.tagName);
          if (siblings.length > 1) sel += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(sel);
        node = parent;
      }
      return parts.join(' > ');
    };

    // "complete with zero naturalWidth" is a definitive load failure; a
    // not-yet-complete lazy image is NOT broken, just not loaded.
    const images = [...document.querySelectorAll('img')].map((img) => ({
      src: img.currentSrc || img.src,
      loaded: !img.complete || img.naturalWidth > 0,
      visible: visible(img),
      alt: img.getAttribute('alt') ?? '',
      selector: cssPath(img),
    })).filter((i) => i.src);

    // http:// assets referenced by the DOM (mixed content)
    const httpAssets = [
      ...document.querySelectorAll('img[src^="http://"], script[src^="http://"], link[href^="http://"], iframe[src^="http://"], source[src^="http://"]'),
    ].map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '').filter(Boolean);

    const deadButtons: { label: string; reason: 'covered' | 'no-action'; selector: string }[] = [];
    const clickables = [
      ...document.querySelectorAll('button, a[role="button"], input[type="submit"], a.btn, a[class*="button"]'),
    ];
    for (const el of clickables.slice(0, 100)) {
      if (!visible(el)) continue;
      const label =
        (el as HTMLElement).innerText?.trim().slice(0, 40) ||
        el.getAttribute('aria-label') ||
        el.getAttribute('value') ||
        '(unlabeled)';

      // Covered: the element at the button's center is unrelated to it.
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
        const top = document.elementFromPoint(cx, cy);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) {
          deadButtons.push({ label, reason: 'covered', selector: cssPath(el) });
          continue;
        }
      }

      if (el.tagName === 'A') {
        const href = el.getAttribute('href');
        const hasHandler = el.hasAttribute('onclick') || el.getAttribute('role') === 'button';
        if ((!href || href === '#' || href === '') && !hasHandler) {
          deadButtons.push({ label, reason: 'no-action', selector: cssPath(el) });
        }
      }
    }

    const meta = (name: string) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
      document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ??
      null;

    const host = location.hostname.replace(/^www\./, '');
    const externalLinks = [
      ...new Set(
        [...document.querySelectorAll('a[href^="http"]')]
          .map((a) => a.getAttribute('href')!)
          .filter((href) => {
            try {
              return new URL(href).hostname.replace(/^www\./, '') !== host;
            } catch {
              return false;
            }
          })
      ),
    ].slice(0, 50);

    const footerText = [...document.querySelectorAll('footer')].map((f) => (f as HTMLElement).innerText).join(' ');
    const copyrightYears = [...footerText.matchAll(/(?:©|&copy;|copyright)\s*(?:\(c\)\s*)?(\d{4})(?:\s*[-–]\s*(\d{4}))?/gi)]
      .flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));

    return {
      images,
      httpAssets,
      deadButtons,
      externalLinks,
      copyrightYears,
      title: document.title ?? '',
      metaDescription: meta('description'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      robotsMeta: meta('robots'),
      ogTitle: meta('og:title'),
      ogImage: meta('og:image'),
      h1Count: document.querySelectorAll('h1').length,
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
        (s) => s.textContent ?? ''
      ),
    };
  });
}

function seoFindings(url: string, s: DomSnapshot): FindingInput[] {
  const out: FindingInput[] = [];
  const warn = (fingerKey: string, message: string, details?: Record<string, unknown>) =>
    out.push({ checkType: 'seo', severity: 'warning', pageUrl: url, message, fingerKey, details });

  if (!s.title.trim()) warn('title', 'Missing <title>');
  else if (s.title.length > 65) warn('title-long', 'Title longer than 65 characters', { length: s.title.length });

  if (!s.metaDescription?.trim()) warn('desc', 'Missing meta description');
  else if (s.metaDescription.length > 165)
    warn('desc-long', 'Meta description longer than 165 characters', { length: s.metaDescription.length });

  if (s.h1Count === 0) warn('h1-none', 'No <h1> on page');
  else if (s.h1Count > 1) warn('h1-multi', 'More than one <h1> on page', { count: s.h1Count });

  if (!s.canonical) warn('canonical', 'Missing canonical link');
  if (!s.ogTitle) warn('og-title', 'Missing og:title');
  if (!s.ogImage) warn('og-image', 'Missing og:image');

  if (s.robotsMeta && /noindex/i.test(s.robotsMeta)) {
    out.push({
      checkType: 'seo',
      severity: 'error',
      pageUrl: url,
      message: 'Page is set to noindex — it will drop out of Google',
      fingerKey: 'noindex',
      details: { robots: s.robotsMeta },
    });
  }
  return out;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function shorten(url: string): string {
  return url.length > 90 ? `${url.slice(0, 87)}...` : url;
}

function dedupeBy<T>(list: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Third-party noise that isn't the client's problem.
const IGNORE_ASSET_PATTERNS = [
  /doubleclick\.net/,
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /facebook\.(net|com)\/tr/,
  /hotjar\.com/,
  /clarity\.ms/,
];

function isIgnorableAsset(url: string): boolean {
  return IGNORE_ASSET_PATTERNS.some((p) => p.test(url));
}

const IGNORE_CONSOLE_PATTERNS = [
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /third-party cookie/i,
  /favicon\.ico/i,
];

function isIgnorableConsole(text: string): boolean {
  return IGNORE_CONSOLE_PATTERNS.some((p) => p.test(text));
}
