import { z } from 'zod';

// Secrets only. Search tunables live in the `settings` table and are edited in
// the dashboard.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
});

let cached: z.infer<typeof envSchema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
