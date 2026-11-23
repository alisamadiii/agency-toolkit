// Creates an admin API key directly in the database and prints it once.
// Usage: DATABASE_URL=... node scripts/admin-key.mjs "Client hub"
import { createHash, randomBytes } from 'node:crypto';

import postgres from 'postgres';

const name = process.argv[2] || 'Admin key';
const sql = postgres(process.env.DATABASE_URL);
const key = `fl_admin_${randomBytes(24).toString('base64url')}`;
const hash = createHash('sha256').update(key).digest('hex');

await sql`INSERT INTO api_key (name, prefix, hash) VALUES (${name}, ${key.slice(0, 14)}, ${hash})`;
console.log(key);
await sql.end();
