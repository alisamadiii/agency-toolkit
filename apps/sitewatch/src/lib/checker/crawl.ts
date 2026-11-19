import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { chromium, type Browser } from 'playwright';

import { db } from '@/db';
import { clients, findings as findingsTable, pages, runs, type Client } from '@/db/schema';

import { alertIncidentDelta } from './alerts';
import { checkContactForm, checkEndpoint, checkQuoteApi } from './forms';
import { reconcileIncidents } from './incidents';
import { checkPage } from './page-checks';
import { discoverPages, USER_AGENT } from './sitemap';
import { checkExternalLinks, siteChecks } from './site-checks';
import type { FindingInput } from './types';

const PAGE_CONCURRENCY = 4;
const STALE_LASTMOD_MONTHS = 12;

declare global {
  // Guards against the cron tick, boot sweep and the Run-now button crawling
  // the same client at once.
  var __wtActiveCrawls: Set<string> | undefined;
}

function activeCrawls(): Set<string> {
  globalThis.__wtActiveCrawls ??= new Set();
  return globalThis.__wtActiveCrawls;
}

export function screenshotsDir(): string {
  return path.join(process.env.DATA_DIR ?? './data', 'screenshots');
}

export async function crawlClient(
  client: Client,
  opts: { jobExecutionId?: string } = {}
): Promise<{ runId: string | null; skipped?: boolean }> {
  if (activeCrawls().has(client.id)) return { runId: null, skipped: true };
  activeCrawls().add(client.id);
  try {
    return { runId: await doCrawl(client, opts.jobExecutionId) };
  } finally {
    activeCrawls().delete(client.id);
  }
}

async function doCrawl(client: Client, jobExecutionId?: string): Promise<string> {
  const [run] = await db
    .insert(runs)
    .values({ clientId: client.id, jobExecutionId: jobExecutionId ?? null })
    .returning();

  try {
    const all: FindingInput[] = [];
    const baseHost = new URL(client.baseUrl).hostname.replace(/^www\./, '');

    // Sitemap + no-browser site checks run in parallel.
    const [sitemap, site] = await Promise.all([
      discoverPages(client.baseUrl, client.sitemapUrl),
      siteChecks(client.baseUrl),
    ]);
    all.push(...sitemap.findings, ...site.findings);

    // Keep the dashboard's cert/domain tile fresh. Only overwrite a value we
    // actually read this run, so a flaky TLS/RDAP read never wipes a good date.
    if (site.sslValidTo || site.domainExpiry) {
      await db
        .update(clients)
        .set({
          ...(site.sslValidTo ? { sslValidTo: site.sslValidTo } : {}),
          ...(site.domainExpiry ? { domainExpiry: site.domainExpiry } : {}),
        })
        .where(eq(clients.id, client.id));
    }

    const now = new Date();
    for (const url of sitemap.urls) {
      await db
        .insert(pages)
        .values({ clientId: client.id, url, lastSeenInSitemapAt: now })
        .onConflictDoUpdate({
          target: [pages.clientId, pages.url],
          set: { lastSeenInSitemapAt: now },
        });
    }

    await db.update(runs).set({ pagesTotal: sitemap.urls.length }).where(eq(runs.id, run.id));

    const criticalUrls = new Set(
      [client.baseUrl, ...(client.criticalPaths ?? []).map((p) => resolvePath(client.baseUrl, p))].map(
        normalizeUrl
      )
    );

    // Stale lastmod on critical pages.
    for (const [url, mod] of sitemap.lastmod) {
      if (!criticalUrls.has(normalizeUrl(url))) continue;
      const modDate = new Date(mod);
      if (!Number.isNaN(modDate.getTime()) && monthsAgo(modDate) > STALE_LASTMOD_MONTHS) {
        all.push({
          checkType: 'stale_content',
          severity: 'warning',
          pageUrl: url,
          message: `Sitemap lastmod is over ${STALE_LASTMOD_MONTHS} months old on a critical page`,
          fingerKey: 'lastmod',
          details: { lastmod: mod },
        });
      }
    }

    const browser = await launchBrowser();
    let checked = 0;
    const externalLinks = new Map<string, string[]>();
    try {
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1366, height: 900 },
      });

      const shotsDir = path.join(screenshotsDir(), run.id);
      await mkdir(shotsDir, { recursive: true });

      const queue = [...sitemap.urls];
      const workers = Array.from({ length: PAGE_CONCURRENCY }, async () => {
        for (;;) {
          const url = queue.shift();
          if (!url) return;
          const page = await context.newPage();
          try {
            const result = await checkPage(page, url, {
              cdnHosts: client.cdnHosts ?? null,
              baseHost,
              shotsDir,
            });
            all.push(...result.findings);
            for (const link of result.externalLinks) {
              externalLinks.set(link, [...(externalLinks.get(link) ?? []), url]);
            }
            if (criticalUrls.has(normalizeUrl(url))) {
              await page
                .screenshot({ path: path.join(shotsDir, `${slugify(url)}.png`), fullPage: false })
                .catch(() => {});
            }
          } catch (error) {
            all.push({
              checkType: 'crawl',
              severity: 'error',
              pageUrl: url,
              message: 'Checker crashed on this page',
              fingerKey: 'crash',
              details: { error: error instanceof Error ? error.message : String(error) },
            });
          } finally {
            checked += 1;
            await page.close().catch(() => {});
          }
        }
      });
      await Promise.all(workers);

      // Forms need the browser context; run after the page sweep.
      if (client.formConfig) {
        all.push(...(await checkContactForm(context, client.formConfig)));
      }
      await context.close();
    } finally {
      await browser.close().catch(() => {});
    }

    if (client.quoteConfig) {
      all.push(...(await checkQuoteApi(client.baseUrl, client.quoteConfig)));
    }

    // Repeatable HTTP endpoint monitors.
    for (const check of client.endpointChecks ?? []) {
      all.push(...(await checkEndpoint(client.baseUrl, check)));
    }

    all.push(...(await checkExternalLinks(externalLinks, new Map())));

    // Site-wide elements (cookie banners, newsletter popups, shared footers)
    // produce the identical finding on every page — collapse those into one.
    const collapsed = collapseSiteWide(all, client.baseUrl);

    // runId inside details lets the UI resolve element screenshots later,
    // even from the incidents table.
    for (const f of collapsed) {
      f.details = { ...f.details, fingerKey: f.fingerKey, runId: run.id };
    }

    if (collapsed.length > 0) {
      await db.insert(findingsTable).values(
        collapsed.map((f) => ({
          runId: run.id,
          clientId: client.id,
          pageUrl: f.pageUrl,
          checkType: f.checkType,
          severity: f.severity,
          message: f.message,
          details: f.details,
        }))
      );
    }

    const errorCount = collapsed.filter((f) => f.severity === 'error').length;
    const warningCount = collapsed.length - errorCount;
    await db
      .update(runs)
      .set({
        finishedAt: new Date(),
        status: errorCount > 0 ? 'failed' : warningCount > 0 ? 'degraded' : 'ok',
        pagesChecked: checked,
        errorCount,
        warningCount,
      })
      .where(eq(runs.id, run.id));

    const delta = await reconcileIncidents(client.id, collapsed);
    await alertIncidentDelta(client, delta, { pagesChecked: checked, errorCount, warningCount });

    return run.id;
  } catch (error) {
    await db
      .update(runs)
      .set({
        finishedAt: new Date(),
        status: 'error',
        errorCount: sql`${runs.errorCount}`,
      })
      .where(eq(runs.id, run.id));
    console.error(`[crawl] run for ${client.name} crashed`, error);
    return run.id;
  }
}

async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

const SITE_WIDE_THRESHOLD = 5;

// Same checkType+fingerKey on >= SITE_WIDE_THRESHOLD pages = a shared
// element/template problem, not N separate ones. One finding, anchored to
// the base URL, with the affected pages in details.
function collapseSiteWide(findings: FindingInput[], baseUrl: string): FindingInput[] {
  const groups = new Map<string, FindingInput[]>();
  for (const f of findings) {
    const key = `${f.checkType}|${f.fingerKey ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const out: FindingInput[] = [];
  for (const group of groups.values()) {
    const pages = new Set(group.map((f) => f.pageUrl));
    if (pages.size >= SITE_WIDE_THRESHOLD) {
      const first = group[0];
      out.push({
        ...first,
        pageUrl: baseUrl,
        message: `${first.message} (site-wide — on ${pages.size} pages)`,
        details: { ...first.details, pages: [...pages].slice(0, 50) },
      });
    } else {
      out.push(...group);
    }
  }
  return out;
}

function resolvePath(baseUrl: string, p: string): string {
  try {
    return new URL(p, baseUrl).href;
  } catch {
    return p;
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function monthsAgo(date: Date): number {
  return (Date.now() - date.getTime()) / (30 * 86_400_000);
}

export function slugify(url: string): string {
  const u = new URL(url);
  const slug = (u.pathname === '/' ? 'home' : u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return slug || 'home';
}
