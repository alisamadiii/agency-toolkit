import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import * as schema from './schema';

// Node has no global WebSocket in every runtime we use (tsx CLI included).
neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle({ client: pool, schema });
