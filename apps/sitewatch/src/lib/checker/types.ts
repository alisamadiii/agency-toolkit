export const CHECK_TYPES = [
  'sitemap',
  'http_status',
  'image_broken',
  'image_not_cdn',
  'asset_failed',
  'mixed_content',
  'button_dead',
  'console_error',
  'seo',
  'security_headers',
  'redirect',
  'perf',
  'external_link',
  'stale_content',
  'structured_data',
  'soft_404',
  'ssl_expiry',
  'domain_expiry',
  'email_dns',
  'form_contact',
  'form_quote',
  'endpoint',
  'uptime',
  'crawl',
] as const;

export type CheckType = (typeof CHECK_TYPES)[number];

export type Severity = 'error' | 'warning';

export type FindingInput = {
  checkType: CheckType;
  severity: Severity;
  pageUrl: string;
  message: string;
  // Stable discriminator for incident fingerprinting (e.g. the broken image
  // src). Variable data (counts, timings) belongs in details, never here.
  fingerKey?: string;
  details?: Record<string, unknown>;
};

export function fingerprintOf(f: FindingInput): string {
  return `${f.checkType}|${f.pageUrl}|${f.fingerKey ?? ''}`;
}
