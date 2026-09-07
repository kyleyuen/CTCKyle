import fs from 'fs';
import path from 'path';
import { pool } from './pool';

/**
 * Tiny migration runner: executes every .sql file in ./migrations in
 * alphabetical order. The migrations use `IF NOT EXISTS`, so re-running is safe.
 *
 * Run with: npm run migrate
 *
 * IMPORTANT: there is no ledger of which migrations have already run, and the
 * existing migration is written with `CREATE TABLE IF NOT EXISTS`. So editing
 * 001_create_tables.sql to add a column does NOTHING on an existing database -
 * the table is already there, the statement is skipped, and you still get
 * "Applied 1 migration(s)." as if it worked.
 *
 * To change the schema, add a NEW file (002_your_change.sql) with an
 * `ALTER TABLE` / `CREATE TABLE` of its own. If you'd rather rewrite 001, wipe
 * the database first with `docker compose down -v` and re-run ./setup.sh.
 *
 * This is deliberately minimal. If you outgrow it, a real migration tool
 * (node-pg-migrate, Knex, Drizzle, ...) is fair game.
 */
async function migrate(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await pool.query(sql);
  }

  console.log(`Applied ${files.length} migration(s).`);
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    pool.end().finally(() => process.exit(1));
  });
