import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from './pool';

/**
 * Migration runner with a ledger.
 *
 * Run with: npm run migrate
 *
 * Each .sql file in ./migrations runs exactly once, in filename order, inside a
 * transaction, and is recorded in `schema_migrations`. Re-running is a no-op.
 *
 * Why the ledger exists. The original runner executed every file on every run
 * and kept no record. That worked only because 001 is written with
 * `CREATE TABLE IF NOT EXISTS`, and it failed in a way that is worse than an
 * error: editing an applied migration to add a column did nothing at all - the
 * table already existed, so the statement was skipped - and the run still
 * printed "Applied 1 migration(s)." A silent failure that reports success is
 * the expensive kind, because you go looking for the bug somewhere else.
 *
 * It also constrained what could be written. Every statement had to be safe to
 * run twice, so `ALTER TABLE ... ADD CONSTRAINT` was unusable and had to be
 * expressed as `CREATE UNIQUE INDEX IF NOT EXISTS` instead. Plenty of SQL has no
 * idempotent form at all - backfills, renames, adding NOT NULL - so those
 * migrations simply could not be written. With a ledger they can.
 *
 * Checksums cover the other half: if an already-applied file is edited, the run
 * fails loudly instead of ignoring the change.
 */

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * The ledger table cannot be created by a migration - it is what records them -
 * so it is created directly. This is the one statement that must stay
 * idempotent.
 */
const CREATE_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    checksum   TEXT        NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

function checksum(sql: string): string {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function migrate(): Promise<void> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  await pool.query(CREATE_LEDGER);

  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations'
  );
  const applied = new Map(rows.map((row) => [row.filename, row.checksum]));

  let count = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const hash = checksum(sql);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== hash) {
        throw new Error(
          `${file} has changed since it was applied. Migrations are immutable ` +
            `once run - add a new file with the change instead, or reset the ` +
            `database with 'docker compose down -v && ./setup.sh'.`
        );
      }
      console.log(`Already applied: ${file}`);
      continue;
    }

    // One transaction per file: a migration that fails halfway leaves neither a
    // half-changed schema nor a ledger row claiming it succeeded. Postgres has
    // transactional DDL, so this covers CREATE and ALTER too.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, hash]
      );
      await client.query('COMMIT');
      console.log(`Applied: ${file}`);
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(
    count === 0
      ? 'Database is up to date; nothing to apply.'
      : `Applied ${count} migration(s).`
  );
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
