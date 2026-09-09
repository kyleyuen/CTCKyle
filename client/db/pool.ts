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
  globalForPool.pool ??
  new Pool({
    connectionString: DATABASE_URL,

    // --- connection limits ---------------------------------------------------
    // Postgres allows 100 connections by default and each one costs memory on
    // the server, so the app takes a bounded slice rather than opening one per
    // request. Requests beyond `max` wait for a free client instead of piling up
    // new connections until the database starts refusing them.
    max: 10,
    // Hand idle connections back instead of holding them open forever.
    idleTimeoutMillis: 30_000,
    // Waiting for a client is not free: fail fast when the database is
    // unreachable or every client is busy, so a request errors in 5s rather
    // than hanging until the caller gives up.
    connectionTimeoutMillis: 5_000,

    // --- query limits --------------------------------------------------------
    // Enforced by Postgres itself, so the query is cancelled and the connection
    // released even if this process has stopped listening. Without it one slow
    // query holds a pooled client indefinitely and, repeated, starves the pool -
    // the failure mode is the whole API hanging, not one slow response. 10s is
    // generous for these endpoints; a long migration or report would need its
    // own connection with a higher limit.
    statement_timeout: 10_000,
    // Client-side backstop for the one case Postgres cannot cover: a connection
    // dropped mid-query, where no answer ever arrives. Deliberately longer than
    // statement_timeout so the server always wins the race - Postgres cancels
    // with SQLSTATE 57014, which is a classified error, whereas this one throws
    // a bare "Query read timeout" carrying no code at all.
    query_timeout: 15_000,
    // A transaction left open holds its locks and blocks other writers. Close
    // sessions that BEGIN and then go quiet.
    idle_in_transaction_session_timeout: 10_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPool.pool = pool;
}

pool.on('error', (err) => {
  // A pooled client errored while idle. Log it; don't crash the process.
  console.error('Unexpected error on idle PostgreSQL client', err);
});
