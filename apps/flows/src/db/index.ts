import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

declare global {
  var __flowsSql: postgres.Sql | undefined;
}

// One pool per process (survives dev hot reloads). Also used directly for LISTEN/NOTIFY.
export const sql = globalThis.__flowsSql ?? postgres(process.env.DATABASE_URL!, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalThis.__flowsSql = sql;

export const db = drizzle(sql, { schema });
