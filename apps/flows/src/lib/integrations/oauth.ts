import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { integration, oauthState, type IntegrationProvider } from '@/db/schema';
import { decrypt, encrypt, sha256 } from '@/lib/crypto';

// Google OAuth for workspace integrations. The connect popup is a top-level page, so it
// can't see the iframe's session: the workspace travels in a hashed, single-use,
// 10-minute state created by an authorized server action. PKCE on top.

const STATE_TTL_MS = 10 * 60_000;

// Overridable for tests only (points at a local fake Google).
const OAUTH_BASE = () => (process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com').replace(/\/$/, '');
const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = () => process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export class IntegrationError extends Error {}

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function publicUrl() {
  const url = process.env.PUBLIC_URL?.replace(/\/$/, '');
  if (!url) throw new IntegrationError('PUBLIC_URL is not set (needed for the Google redirect).');
  return url;
}

export const googleRedirectUri = () => `${publicUrl()}/api/integrations/google/callback`;

function credentials() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new IntegrationError('Google sign-in is not set up on this server (GOOGLE_CLIENT_ID).');
  return { id, secret };
}

async function postForm(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

// ---------- Connect ----------

export async function startConnect(workspaceId: string, provider: IntegrationProvider) {
  const { id } = credentials();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await db.insert(oauthState).values({
    hash: sha256(state),
    workspaceId,
    provider,
    codeVerifier: encrypt(verifier),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  const url = new URL(AUTH_URL());
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export async function finishConnect(state: string, code: string) {
  if (!state || !code) throw new IntegrationError('Missing sign-in details. Try connecting again.');
  // Single use: mark it used in the same statement that checks it.
  const [row] = await db
    .update(oauthState)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthState.hash, sha256(state)), isNull(oauthState.usedAt), gt(oauthState.expiresAt, new Date())))
    .returning();
  if (!row) throw new IntegrationError('This sign-in link expired. Close this window and connect again.');

  const { id, secret } = credentials();
  const token = await postForm(`${OAUTH_BASE()}/token`, {
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
    code_verifier: decrypt(row.codeVerifier),
  });
  if (!token.ok || typeof token.json.access_token !== 'string') {
    throw new IntegrationError('Google did not accept the sign-in. Try connecting again.');
  }
  const accessToken = token.json.access_token;
  const granted = String(token.json.scope ?? '').split(' ').filter(Boolean);
  if (!granted.includes('https://www.googleapis.com/auth/calendar.events')) {
    throw new IntegrationError('Calendar access was not granted. Connect again and allow calendar access.');
  }

  const info = await fetch(USERINFO_URL(), {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  }).then((r) => r.json() as Promise<{ email?: string; name?: string }>);
  if (!info.email) throw new IntegrationError('Could not read your Google account email.');

  const values = {
    accountEmail: info.email,
    accountName: info.name ?? null,
    scopes: granted,
    accessToken: encrypt(accessToken),
    // Google only sends a refresh token on consent; keep the old one if it's missing.
    ...(typeof token.json.refresh_token === 'string' ? { refreshToken: encrypt(token.json.refresh_token) } : {}),
    expiresAt: new Date(Date.now() + Number(token.json.expires_in ?? 3600) * 1000),
    status: 'connected' as const,
    updatedAt: new Date(),
  };
  await db
    .insert(integration)
    .values({ workspaceId: row.workspaceId, provider: row.provider, settings: { calendarId: 'primary' }, ...values })
    .onConflictDoUpdate({ target: [integration.workspaceId, integration.provider], set: values });
  return { workspaceId: row.workspaceId, provider: row.provider, email: info.email };
}

// ---------- Tokens ----------

type IntegrationRow = typeof integration.$inferSelect;

export async function getIntegration(workspaceId: string, provider: IntegrationProvider) {
  const [row] = await db
    .select()
    .from(integration)
    .where(and(eq(integration.workspaceId, workspaceId), eq(integration.provider, provider)));
  return row ?? null;
}

// A valid access token, refreshed when it expires within a minute.
export async function accessTokenFor(row: IntegrationRow): Promise<string> {
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000 && row.status === 'connected') {
    return decrypt(row.accessToken);
  }
  if (!row.refreshToken) return markReconnect(row);
  const { id, secret } = credentials();
  const res = await postForm(`${OAUTH_BASE()}/token`, {
    client_id: id,
    client_secret: secret,
    refresh_token: decrypt(row.refreshToken),
    grant_type: 'refresh_token',
  });
  if (!res.ok || typeof res.json.access_token !== 'string') return markReconnect(row);
  await db
    .update(integration)
    .set({
      accessToken: encrypt(res.json.access_token),
      expiresAt: new Date(Date.now() + Number(res.json.expires_in ?? 3600) * 1000),
      status: 'connected',
      updatedAt: new Date(),
    })
    .where(eq(integration.id, row.id));
  return res.json.access_token;
}

async function markReconnect(row: IntegrationRow): Promise<never> {
  await db.update(integration).set({ status: 'needs_reconnect', updatedAt: new Date() }).where(eq(integration.id, row.id));
  throw new IntegrationError('Google Calendar needs to be reconnected (Automations → Integrations).');
}

export async function disconnect(workspaceId: string, provider: IntegrationProvider) {
  const row = await getIntegration(workspaceId, provider);
  if (!row) return;
  // Best effort: tell Google to drop the grant.
  const token = row.refreshToken ? decrypt(row.refreshToken) : decrypt(row.accessToken);
  await postForm(`${OAUTH_BASE()}/revoke`, { token }).catch(() => {});
  await db.delete(integration).where(eq(integration.id, row.id));
}

export async function updateSettings(workspaceId: string, provider: IntegrationProvider, settings: Record<string, unknown>) {
  const row = await getIntegration(workspaceId, provider);
  if (!row) throw new IntegrationError('Not connected');
  await db
    .update(integration)
    .set({ settings: { ...row.settings, ...settings }, updatedAt: new Date() })
    .where(eq(integration.id, row.id));
}

// What the UI and API may see (never tokens).
export function publicIntegration(row: IntegrationRow) {
  return {
    provider: row.provider,
    accountEmail: row.accountEmail,
    accountName: row.accountName,
    status: row.status,
    settings: row.settings,
    connectedAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
