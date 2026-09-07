// Load .env as a side effect on import. pool.ts is imported by the API route
// handlers (inside Next) and by the standalone migrate/seed scripts, so every
// entry point gets DATABASE_URL without wiring up dotenv itself.
import 'dotenv/config';
import { Pool } from 'pg';

// Defaults to the database `docker compose up -d` starts for you, so the app
// runs with no .env at all. Set DATABASE_URL (in client/.env) to point
// somewhere else - a different port, or a Postgres you manage yourself.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/feeding_brennen';

// Reuse a single pool across hot reloads in dev. Next re-imports modules on
// every change, which would otherwise leak a new Pool (and its connections)
// every time you save a file.
const globalForPool = globalThis as unknown as { pool?: Pool };

/**
 * A single shared connection pool for the whole app. Import this `pool`
 * anywhere you need to talk to the database, e.g.
 *
 *   import { pool } from '@/db/pool';
 *   const { rows } = await pool.query('SELECT * FROM restaurants');
 */
export const pool =
  globalForPool.pool ?? new Pool({ connectionString: DATABASE_URL });

if (process.env.NODE_ENV !== 'production') {
  globalForPool.pool = pool;
}

pool.on('error', (err) => {
  // A pooled client errored while idle. Log it; don't crash the process.
  console.error('Unexpected error on idle PostgreSQL client', err);
});
