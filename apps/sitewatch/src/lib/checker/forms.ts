import type { BrowserContext } from 'playwright';

import type { EndpointCheck, FormConfig, QuoteConfig } from '@/db/schema';

import { USER_AGENT } from './sitemap';
import type { FindingInput } from './types';

// Test-marker protocol (see HEALTHCHECK.md): submissions carry the marker
// email + `_healthcheck` field; patched client backends validate everything
// but skip sending the real email.
export const HEALTHCHECK_EMAIL = 'healthcheck@alisamadii.com';
export const HEALTHCHECK_FIELD = '_healthcheck';

export async function checkContactForm(
  context: BrowserContext,
  config: FormConfig
): Promise<FindingInput[]> {
  const fail = (message: string, details?: Record<string, unknown>): FindingInput[] => [
    { checkType: 'form_contact', severity: 'error', pageUrl: config.pageUrl, message, fingerKey: 'contact', details },
  ];

  const page = await context.newPage();
  try {
    await page.goto(config.pageUrl, { waitUntil: 'load', timeout: 30_000 });

    for (const [selector, value] of Object.entries(config.fields)) {
      const field = page.locator(selector).first();
      if ((await field.count()) === 0) {
        return fail(`Form field not found: ${selector}`);
      }
      await field.fill(value.replaceAll('{{email}}', HEALTHCHECK_EMAIL));
    }

    // Inject the marker so a patched backend knows to skip the real send.
    await page.evaluate((markerField) => {
      for (const form of document.querySelectorAll('form')) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = markerField;
        input.value = '1';
        form.appendChild(input);
      }
    }, HEALTHCHECK_FIELD);

    const submit = page.locator(config.submitSelector).first();
    if ((await submit.count()) === 0) {
      return fail(`Submit button not found: ${config.submitSelector}`);
    }
    await submit.click();

    try {
      await page.locator(config.successSelector).first().waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      return fail('Form submitted but no success state appeared', {
        successSelector: config.successSelector,
      });
    }
    return [];
  } catch (error) {
    return fail('Contact form check crashed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// Generic HTTP endpoint monitor: hit the URL, assert status (and optionally
// that the JSON response contains expected keys). One finding per failing
// endpoint, fingerprinted by the endpoint's stable id so checks never collide.
export async function checkEndpoint(
  baseUrl: string,
  check: EndpointCheck
): Promise<FindingInput[]> {
  const url = check.url.startsWith('http') ? check.url : new URL(check.url, baseUrl).href;
  const fail = (message: string, details?: Record<string, unknown>): FindingInput[] => [
    {
      checkType: 'endpoint',
      severity: 'error',
      pageUrl: url,
      message: `${check.name}: ${message}`,
      fingerKey: `endpoint:${check.id}`,
      details,
    },
  ];

  try {
    const sendsBody = check.method === 'POST' || check.method === 'PUT';
    const res = await fetch(url, {
      method: check.method,
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: sendsBody && check.body ? check.body : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    const statusOk = check.expectStatus ? res.status === check.expectStatus : res.ok;
    if (!statusOk) {
      return fail(
        `expected ${check.expectStatus ?? '2xx'}, got HTTP ${res.status}`,
        { status: res.status }
      );
    }

    if (check.expectKeys?.length) {
      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        return fail('response was not JSON');
      }
      const missing = check.expectKeys.filter((key) => !(key in body));
      if (missing.length > 0) {
        return fail(`response is missing keys: ${missing.join(', ')}`, { missing });
      }
    }
    return [];
  } catch (error) {
    return fail('unreachable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function checkQuoteApi(
  baseUrl: string,
  config: QuoteConfig
): Promise<FindingInput[]> {
  const fail = (message: string, details?: Record<string, unknown>): FindingInput[] => [
    { checkType: 'form_quote', severity: 'error', pageUrl: config.endpoint, message, fingerKey: 'quote', details },
  ];

  try {
    const endpoint = config.endpoint.startsWith('http')
      ? config.endpoint
      : new URL(config.endpoint, baseUrl).href;
    const res = await fetch(endpoint, {
      method: config.method ?? 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({
        ...config.sampleBody,
        email: HEALTHCHECK_EMAIL,
        [HEALTHCHECK_FIELD]: '1',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return fail(`Quote API responded with HTTP ${res.status}`, { status: res.status });
    }

    if (config.expectKeys?.length) {
      let body: Record<string, unknown>;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        return fail('Quote API did not return JSON');
      }
      const missing = config.expectKeys.filter((key) => !(key in body));
      if (missing.length > 0) {
        return fail(`Quote API response is missing keys: ${missing.join(', ')}`, { missing });
      }
    }
    return [];
  } catch (error) {
    return fail('Quote API unreachable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
