import { connect as tlsConnect } from 'node:tls';
import { resolveTxt } from 'node:dns/promises';

import { USER_AGENT } from './sitemap';
import type { FindingInput } from './types';

const TIMEOUT = 15_000;

export type SiteChecksResult = {
  findings: FindingInput[];
  // Parsed expiry dates, surfaced on every crawl (even when healthy) so the
  // dashboard can show "valid until". Null when unreadable/not HTTPS/RDAP flaky.
  sslValidTo: Date | null;
  domainExpiry: Date | null;
};

// Site-wide checks that need no browser: SSL, domain expiry, email DNS,
// redirect hygiene, security headers, soft-404 behaviour.
export async function siteChecks(baseUrl: string): Promise<SiteChecksResult> {
  const [ssl, domain, rest] = await Promise.all([
    sslExpiry(baseUrl).catch(() => ({ findings: [] as FindingInput[], validTo: null })),
    domainExpiry(baseUrl).catch(() => ({ findings: [] as FindingInput[], expiry: null })),
    Promise.allSettled([
      emailDns(baseUrl),
      redirectHygiene(baseUrl),
      securityHeaders(baseUrl),
      soft404(baseUrl),
    ]),
  ]);

  return {
    findings: [
      ...ssl.findings,
      ...domain.findings,
      ...rest.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    ],
    sslValidTo: ssl.validTo,
    domainExpiry: domain.expiry,
  };
}

async function sslExpiry(
  baseUrl: string
): Promise<{ findings: FindingInput[]; validTo: Date | null }> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:') {
    return {
      validTo: null,
      findings: [
        {
          checkType: 'ssl_expiry',
          severity: 'error',
          pageUrl: baseUrl,
          message: 'Site is not served over HTTPS',
          fingerKey: 'no-https',
        },
      ],
    };
  }

  const validTo = await new Promise<Date | null>((resolve) => {
    const socket = tlsConnect(
      { host: url.hostname, port: 443, servername: url.hostname, timeout: TIMEOUT },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
      }
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });

  if (!validTo) {
    return {
      validTo: null,
      findings: [
        {
          checkType: 'ssl_expiry',
          severity: 'error',
          pageUrl: baseUrl,
          message: 'Could not read the SSL certificate',
          fingerKey: 'unreadable',
        },
      ],
    };
  }

  const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) {
    return {
      validTo,
      findings: [
        {
          checkType: 'ssl_expiry',
          severity: 'error',
          pageUrl: baseUrl,
          message: 'SSL certificate has EXPIRED',
          fingerKey: 'expired',
          details: { validTo: validTo.toISOString() },
        },
      ],
    };
  }
  if (daysLeft <= 21) {
    return {
      validTo,
      findings: [
        {
          checkType: 'ssl_expiry',
          severity: daysLeft <= 7 ? 'error' : 'warning',
          pageUrl: baseUrl,
          message: 'SSL certificate expires soon',
          fingerKey: 'expiring',
          details: { daysLeft, validTo: validTo.toISOString() },
        },
      ],
    };
  }
  return { findings: [], validTo };
}

async function domainExpiry(
  baseUrl: string
): Promise<{ findings: FindingInput[]; expiry: Date | null }> {
  const domain = apexDomain(new URL(baseUrl).hostname);
  let expiry: Date | null = null;
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept: 'application/rdap+json', 'user-agent': USER_AGENT },
    });
    if (!res.ok) return { findings: [], expiry: null };
    const data = (await res.json()) as {
      events?: { eventAction: string; eventDate: string }[];
    };
    const event = data.events?.find((e) => e.eventAction === 'expiration');
    if (event) expiry = new Date(event.eventDate);
  } catch {
    return { findings: [], expiry: null }; // RDAP flakiness is not a client incident
  }
  if (!expiry) return { findings: [], expiry: null };

  const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) {
    return {
      expiry,
      findings: [
        {
          checkType: 'domain_expiry',
          severity: 'error',
          pageUrl: baseUrl,
          message: `Domain ${domain} has EXPIRED`,
          fingerKey: 'expired',
          details: { expiry: expiry.toISOString() },
        },
      ],
    };
  }
  if (daysLeft <= 30) {
    return {
      expiry,
      findings: [
        {
          checkType: 'domain_expiry',
          severity: daysLeft <= 14 ? 'error' : 'warning',
          pageUrl: baseUrl,
          message: `Domain ${domain} expires soon`,
          fingerKey: 'expiring',
          details: { daysLeft, expiry: expiry.toISOString() },
        },
      ],
    };
  }
  return { findings: [], expiry };
}

async function emailDns(baseUrl: string): Promise<FindingInput[]> {
  const domain = apexDomain(new URL(baseUrl).hostname);
  const findings: FindingInput[] = [];

  const txt = async (name: string) => {
    try {
      return (await resolveTxt(name)).map((parts) => parts.join(''));
    } catch {
      return [];
    }
  };

  const root = await txt(domain);
  if (!root.some((r) => r.startsWith('v=spf1'))) {
    findings.push({
      checkType: 'email_dns',
      severity: 'warning',
      pageUrl: baseUrl,
      message: `No SPF record on ${domain} — its outgoing email may land in spam`,
      fingerKey: 'spf',
    });
  }

  const dmarc = await txt(`_dmarc.${domain}`);
  if (!dmarc.some((r) => r.startsWith('v=DMARC1'))) {
    findings.push({
      checkType: 'email_dns',
      severity: 'warning',
      pageUrl: baseUrl,
      message: `No DMARC record on ${domain}`,
      fingerKey: 'dmarc',
    });
  }

  return findings;
}

async function redirectHygiene(baseUrl: string): Promise<FindingInput[]> {
  const base = new URL(baseUrl);
  const findings: FindingInput[] = [];
  const bareHost = base.hostname.replace(/^www\./, '');
  const variants = [
    `http://${bareHost}/`,
    `http://www.${bareHost}/`,
    `https://${base.hostname.startsWith('www.') ? bareHost : `www.${bareHost}`}/`,
  ];

  for (const variant of variants) {
    try {
      const res = await fetch(variant, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'user-agent': USER_AGENT },
      });
      const landedHost = new URL(res.url).hostname;
      const landedProto = new URL(res.url).protocol;
      if (landedProto !== 'https:' || landedHost.replace(/^www\./, '') !== bareHost) {
        findings.push({
          checkType: 'redirect',
          severity: 'warning',
          pageUrl: baseUrl,
          message: `${variant} does not end up on the canonical https site`,
          fingerKey: variant,
          details: { from: variant, landed: res.url },
        });
      }
    } catch {
      findings.push({
        checkType: 'redirect',
        severity: 'warning',
        pageUrl: baseUrl,
        message: `${variant} is unreachable`,
        fingerKey: `${variant}-unreachable`,
      });
    }
  }
  return findings;
}

async function securityHeaders(baseUrl: string): Promise<FindingInput[]> {
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': USER_AGENT },
    });
    const missing = [
      'strict-transport-security',
      'x-content-type-options',
    ].filter((h) => !res.headers.get(h));
    const hasFrameProtection =
      res.headers.get('x-frame-options') ||
      res.headers.get('content-security-policy')?.includes('frame-ancestors');
    if (!hasFrameProtection) missing.push('x-frame-options / CSP frame-ancestors');

    if (missing.length > 0) {
      return [
        {
          checkType: 'security_headers',
          severity: 'warning',
          pageUrl: baseUrl,
          message: `Missing security headers: ${missing.join(', ')}`,
          fingerKey: 'headers',
          details: { missing },
        },
      ];
    }
  } catch {
    // unreachable site is reported by other checks
  }
  return [];
}

async function soft404(baseUrl: string): Promise<FindingInput[]> {
  const probe = new URL('/wt-health-probe-this-page-should-not-exist', baseUrl).href;
  try {
    const res = await fetch(probe, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': USER_AGENT },
    });
    if (res.status === 200) {
      return [
        {
          checkType: 'soft_404',
          severity: 'warning',
          pageUrl: baseUrl,
          message: 'Non-existent URLs return 200 instead of 404 (soft-404 — bad for SEO)',
          fingerKey: 'soft404',
        },
      ];
    }
    if (res.status >= 500) {
      return [
        {
          checkType: 'soft_404',
          severity: 'error',
          pageUrl: baseUrl,
          message: `Non-existent URLs crash the server (HTTP ${res.status})`,
          fingerKey: '500',
          details: { status: res.status },
        },
      ];
    }
  } catch {
    // ignore
  }
  return [];
}

export async function checkExternalLinks(
  links: Map<string, string[]>, // link url -> page urls that contain it
  cache: Map<string, boolean>
): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const targets = [...links.keys()].slice(0, 50);

  for (const link of targets) {
    if (!cache.has(link)) {
      cache.set(link, await isLinkAlive(link));
    }
    if (cache.get(link) === false) {
      const [firstPage] = links.get(link)!;
      findings.push({
        checkType: 'external_link',
        severity: 'warning',
        pageUrl: firstPage,
        message: `Outbound link is dead: ${link.length > 80 ? `${link.slice(0, 77)}...` : link}`,
        fingerKey: link,
        details: { link, onPages: links.get(link)!.slice(0, 5) },
      });
    }
  }
  return findings;
}

async function isLinkAlive(url: string): Promise<boolean> {
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': USER_AGENT },
    });
    // Many servers reject HEAD; retry those with GET before judging.
    if (res.status >= 400 && res.status !== 404 && res.status !== 410) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': USER_AGENT },
      });
    }
    // Only hard-dead statuses count; bot walls (403/429/999) are not "dead".
    return !(res.status === 404 || res.status === 410);
  } catch {
    return false;
  }
}

function apexDomain(hostname: string): string {
  const parts = hostname.replace(/^www\./, '').split('.');
  // Good enough for .com/.io/etc. and common two-part TLDs like .co.uk.
  if (parts.length > 2 && parts.at(-2)!.length <= 3 && parts.at(-1)!.length <= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}
