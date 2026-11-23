import { createHash, createHmac, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db } from '@/db';
import { embedTicket, workspace, type EmbedRole } from '@/db/schema';
import { encrypt, randomToken, safeEqual, sha256 } from '@/lib/crypto';

// Client hub embed: the hub's server (admin key) asks for a one-time ticket for one hub
// project; /iframe/start trades it for a signed cookie pinned to that project's workspace.
// Nothing in the browser can change which workspace a session sees.

export const EMBED_COOKIE = 'flows_embed';
export const EMBED_PATH = '/iframe';
const TICKET_TTL_MS = 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

const RANK: Record<EmbedRole, number> = { 'view-only': 0, 'content-editor': 1, 'full-access': 2 };

export function roleAtLeast(role: EmbedRole, min: EmbedRole) {
  return RANK[role] >= RANK[min];
}

// Origins allowed to frame /iframe (comma separated). Production: the client hub only.
export function embedAllowedOrigins(): string[] {
  return (process.env.EMBED_ALLOWED_ORIGINS || 'https://app.alisamadii.com')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// ---------- Tickets ----------

export type EmbedUser = { id?: string; email?: string; name?: string };

export async function createEmbedTicket(input: {
  projectId: string;
  projectName: string;
  user: EmbedUser;
  role: EmbedRole;
}) {
  // One workspace per hub project. Its id IS the hub project id, so both systems share
  // the same identifier (external_id keeps the link explicit as well).
  let [ws] = await db
    .select()
    .from(workspace)
    .where(or(eq(workspace.id, input.projectId), eq(workspace.externalId, input.projectId)));
  if (!ws) {
    const hosts = (process.env.EMBED_DEFAULT_ALLOWED_HOSTS ?? '*')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    const slug = `hub-${input.projectId.slice(0, 8)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    [ws] = await db
      .insert(workspace)
      .values({
        id: input.projectId,
        name: input.projectName,
        slug,
        externalId: input.projectId,
        allowedHosts: hosts,
        signingSecret: encrypt(randomToken(32)),
      })
      .onConflictDoNothing()
      .returning();
    // Lost a race with a parallel first open: use the one that won.
    if (!ws) [ws] = await db.select().from(workspace).where(eq(workspace.id, input.projectId));
  } else if (input.projectName && ws.name !== input.projectName) {
    // Keep the name in sync with the hub.
    await db.update(workspace).set({ name: input.projectName }).where(eq(workspace.id, ws.id));
  }

  const raw = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
  await db.insert(embedTicket).values({
    hash: sha256(raw),
    workspaceId: ws.id,
    role: input.role,
    user: input.user,
    expiresAt,
  });
  return { ticket: raw, workspaceId: ws.id, expiresAt };
}

// Marks the ticket used and returns it, or null if unknown, used or expired.
export async function redeemTicket(raw: string) {
  if (!raw || raw.length > 200) return null;
  const [row] = await db
    .update(embedTicket)
    .set({ usedAt: new Date() })
    .where(and(eq(embedTicket.hash, sha256(raw)), isNull(embedTicket.usedAt), gt(embedTicket.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

// ---------- Session cookie ----------

export type EmbedSession = {
  workspaceId: string;
  role: EmbedRole;
  email: string;
  name: string;
  exp: number;
};

function sessionKey() {
  const master = process.env.MASTER_KEY;
  if (!master) throw new Error('MASTER_KEY is not set');
  return createHash('sha256').update(`flows-embed-session:${master}`).digest();
}

function sign(body: string) {
  return createHmac('sha256', sessionKey()).update(body).digest('base64url');
}

export function encodeSession(s: Omit<EmbedSession, 'exp'>): { value: string; expires: Date } {
  const exp = Date.now() + SESSION_TTL_MS;
  const body = Buffer.from(JSON.stringify({ ...s, exp })).toString('base64url');
  return { value: `${body}.${sign(body)}`, expires: new Date(exp) };
}

export function decodeSession(value: string | undefined): EmbedSession | null {
  if (!value) return null;
  const [body, mac] = value.split('.');
  if (!body || !mac || !safeEqual(mac, sign(body))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as EmbedSession;
    if (typeof s.exp !== 'number' || s.exp < Date.now()) return null;
    if (!(s.role in RANK) || typeof s.workspaceId !== 'string') return null;
    return s;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  partitioned: true,
  path: EMBED_PATH,
  expires,
});

export class EmbedError extends Error {
  constructor(
    public status: 401 | 403,
    message: string
  ) {
    super(message);
  }
}

export async function readEmbed(): Promise<EmbedSession | null> {
  return decodeSession((await cookies()).get(EMBED_COOKIE)?.value);
}

// The pinned workspace for this request. Throws 401 without a session, 403 below `min`.
export async function requireEmbed(min: EmbedRole = 'view-only'): Promise<EmbedSession> {
  const session = await readEmbed();
  if (!session) throw new EmbedError(401, 'Your session ended. Reload the page.');
  if (!roleAtLeast(session.role, min)) throw new EmbedError(403, "You don't have permission to do that.");
  return session;
}

