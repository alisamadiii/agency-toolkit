import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';

import ipaddr from 'ipaddr.js';

// Ranges no step may reach: loopback, private, link-local (cloud metadata), CGNAT, multicast.
// Also handed to Deno as --deny-net, which checks resolved IPs too.
export const BLOCKED_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

// Entries: "api.example.com", "*.example.com" (any subdomain), "*" (any public host).
export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((raw) => {
    const entry = raw.toLowerCase().trim();
    if (entry === '*') return true;
    if (entry.startsWith('*.')) return h.endsWith(entry.slice(1));
    return h === entry;
  });
}

// Rejects hosts that are internal by name. Public names that resolve to private IPs
// are caught at connect time by `guardedLookup` / Deno's --deny-net.
export function allowedHostError(entry: string): string | null {
  const e = entry.toLowerCase().trim();
  if (e === '*') return null;
  const bare = e.startsWith('*.') ? e.slice(2) : e;
  if (!/^[a-z0-9.-]+$/.test(bare)) return `"${entry}" is not a hostname`;
  if (ipaddr.isValid(bare)) return isPublicAddress(bare) ? null : `"${entry}" is a private address`;
  if (!bare.includes('.')) return `"${entry}" must be a full domain`;
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.internal') || bare.endsWith('.local')) {
    return `"${entry}" is an internal host`;
  }
  return null;
}

// DNS lookup that refuses private addresses, so a public name can't be pointed at
// Postgres or another container (DNS rebinding).
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new Error(`Blocked: ${hostname} resolves to a private address`), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type GuardedResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
};

const MAX_BODY = 1024 * 1024;
const MAX_REDIRECTS = 5;

export class NetError extends Error {}

// fetch-like request with SSRF protection, host allow-list, size cap and timeout.
export async function guardedRequest(opts: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  allowedHosts: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<GuardedResponse> {
  let url = new URL(opts.url);
  let method = opts.method;
  let body = opts.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new NetError(`Only http and https URLs are allowed (got ${url.protocol})`);
    }
    if (!hostAllowed(url.hostname, opts.allowedHosts)) {
      throw new NetError(`Host "${url.hostname}" is not in this workspace's allowed hosts`);
    }
    const bareHost = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(bareHost) && !isPublicAddress(bareHost)) {
      throw new NetError(`Blocked: ${bareHost} is a private address`);
    }

    const res = await requestOnce(url, method, opts.headers, body, opts.timeoutMs, opts.signal);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return res;
  }
  throw new NetError('Too many redirects');
}

function requestOnce(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<GuardedResponse> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: { 'user-agent': 'flows/1.0', ...headers },
        lookup: guardedLookup,
        timeout: timeoutMs,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (size >= MAX_BODY) {
            truncated = true;
            return;
          }
          size += chunk.length;
          chunks.push(chunk);
        });
        res.on('end', () => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: out,
            body: Buffer.concat(chunks).subarray(0, MAX_BODY).toString('utf8'),
            truncated,
          });
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new NetError(`Timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
