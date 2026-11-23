import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { count } from 'drizzle-orm';

import { db } from '@/db';
import * as schema from '@/db/schema';

// Tolerate host-only values (Coolify's SERVICE_FQDN_* vars have no scheme).
function normalizeBaseUrl(raw: string | undefined) {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^https?:\/\//.test(value)) return value;
  return `https://${value.replace(/:\d+$/, '')}`;
}

export const auth = betterAuth({
  baseURL: normalizeBaseUrl(process.env.BETTER_AUTH_URL),
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // First account becomes the owner; after that sign-up is closed.
        before: async (userData) => {
          const [{ value }] = await db.select({ value: count() }).from(schema.user);
          if (value > 0) {
            throw new APIError('FORBIDDEN', { message: 'Sign-up is closed. This instance already has an owner.' });
          }
          return { data: { ...userData, role: 'admin' } };
        },
      },
    },
  },
  advanced: {
    // Avoids clashing with other apps' Better Auth cookies on a shared parent domain.
    cookiePrefix: 'flows',
  },
  plugins: [nextCookies()],
});

export async function hasAnyUser() {
  const [{ value }] = await db.select({ value: count() }).from(schema.user);
  return value > 0;
}
