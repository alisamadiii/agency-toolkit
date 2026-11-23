import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z, type ZodType } from 'zod';

import { db } from '@/db';
import { apiKey } from '@/db/schema';
import { safeEqual, sha256 } from '@/lib/crypto';
import { EnqueueError } from '@/lib/engine/queue';
import { ServiceError } from '@/lib/service';

export type Principal = { keyId: string; admin: boolean; workspaceId: string | null };

export class ApiError extends ServiceError {}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function errorResponse(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

// ---------- Auth ----------

function readKey(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return req.headers.get('x-api-key')?.trim() ?? '';
}

async function authenticate(req: NextRequest): Promise<Principal | null> {
  const key = readKey(req);
  if (!key.startsWith('fl_')) return null;
  const hash = sha256(key);
  const [row] = await db
    .select()
    .from(apiKey)
    .where(and(eq(apiKey.hash, hash), isNull(apiKey.revokedAt)));
  if (!row || !safeEqual(row.hash, hash)) return null;
  // Best effort, at most once a minute.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    void db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.id)).catch(() => {});
  }
  return { keyId: row.id, admin: row.workspaceId === null, workspaceId: row.workspaceId };
}

// ---------- Rate limit (per key, per process) ----------

const RATE_LIMIT = Number(process.env.API_RATE_LIMIT_PER_MIN) || 600;
const buckets = new Map<string, { tokens: number; at: number }>();

function allow(keyId: string) {
  const now = Date.now();
  const b = buckets.get(keyId) ?? { tokens: RATE_LIMIT, at: now };
  b.tokens = Math.min(RATE_LIMIT, b.tokens + ((now - b.at) / 60_000) * RATE_LIMIT);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(keyId, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(keyId, b);
  return true;
}

// ---------- Handler wrapper ----------

type Ctx<P> = { params: Promise<P> };

type Options = { admin?: boolean };

// Wraps a route: authenticates, rate limits, and turns thrown errors into JSON.
export function route<P = Record<string, string>>(
  handler: (req: NextRequest, auth: Principal, params: P) => Promise<Response>,
  options: Options = {}
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      const principal = await authenticate(req);
      if (!principal) return errorResponse(401, 'Invalid or missing API key');
      if (!allow(principal.keyId)) return errorResponse(429, 'Too many requests');
      if (options.admin && !principal.admin) return errorResponse(403, 'Admin key required');
      return await handler(req, principal, await ctx.params);
    } catch (error) {
      if (error instanceof ServiceError) return errorResponse(error.status, error.message, error.details);
      if (error instanceof EnqueueError) return errorResponse(409, error.message);
      console.error('[api]', error);
      return errorResponse(500, 'Internal error');
    }
  };
}

// Workspace keys act on their own workspace; admin keys pick one with x-workspace-id.
export function workspaceOf(req: NextRequest, auth: Principal): string {
  if (auth.workspaceId) return auth.workspaceId;
  const id = req.headers.get('x-workspace-id');
  if (!id) throw new ApiError(400, 'Admin keys must send x-workspace-id');
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, 'x-workspace-id must be a UUID');
  return id;
}

export async function body<T extends ZodType>(req: NextRequest, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, 'Body must be JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'Validation failed', z.flattenError(parsed.error));
  return parsed.data;
}

export function uuidParam(value: string, what = 'id') {
  if (!z.uuid().safeParse(value).success) throw new ApiError(404, `${what} not found`);
  return value;
}
