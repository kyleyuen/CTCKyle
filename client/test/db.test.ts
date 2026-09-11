import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';

import { pool } from '../db/pool';
import { toRestaurant } from '../lib/types';

/**
 * Database tests: the guarantees that hold when nothing goes through the API.
 *
 * The API validates its own requests, but it is not the only way into this
 * database - psql, a GUI client, the seed script and any future service all
 * write directly. These tests assert the rules the schema enforces on its own,
 * so a constraint that quietly stopped working fails here rather than years
 * later in production data.
 *
 * Every destructive assertion runs inside a transaction that is rolled back, so
 * the suite commits nothing and is safe against a database with real data in it.
 */

/** Run `fn` in a transaction and always roll it back. */
async function inRollback<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/**
 * The SQLSTATE a query rejects with, or null if it succeeded.
 *
 * Wrapped in a savepoint because Postgres aborts the whole transaction on the
 * first error: without this, every statement after a failure returns 25P02
 * (in_failed_sql_transaction) instead of its own code, so only the first
 * assertion in a test would mean anything.
 */
async function sqlstate(
  client: PoolClient,
  sql: string,
  params: unknown[] = []
): Promise<string | null> {
  await client.query('SAVEPOINT trial');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT trial');
    return null;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT trial');
    return (err as { code?: string }).code ?? 'unknown';
  }
}

const insertRestaurant = `INSERT INTO restaurants (name, cuisine, address, rating)
                          VALUES ($1, $2, $3, $4) RETURNING id`;

after(() => pool.end());

// --- schema -----------------------------------------------------------------

describe('schema', () => {
  test('the expected tables exist', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tables = rows.map((r) => r.table_name);

    for (const expected of ['restaurants', 'visits', 'schema_migrations']) {
      assert.ok(tables.includes(expected), `missing table ${expected}`);
    }
  });

  test('restaurants has the columns the API contract publishes', async () => {
    const { rows } = await pool.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'restaurants' ORDER BY column_name`
    );
    const columns = Object.fromEntries(
      rows.map((r) => [r.column_name, r.is_nullable])
    );

    assert.deepEqual(Object.keys(columns).sort(), [
      'address',
      'created_at',
      'cuisine',
      'id',
      'name',
      'rating',
    ]);
    // name is the only required field; the rest are genuinely optional, which
    // is why the schema allows null and the API accepts an omitted key.
    assert.equal(columns.name, 'NO');
    assert.equal(columns.cuisine, 'YES');
    assert.equal(columns.rating, 'YES');
  });

  test('the indexes the queries depend on exist', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'restaurants'`
    );
    const indexes = rows.map((r) => r.indexname);

    // Keyset pagination seeks along this one; without it the seek degrades to a
    // scan, which the benchmark measures at roughly 11x slower.
    assert.ok(indexes.includes('idx_restaurants_created_at'));
    // Case-insensitive uniqueness on name, which is what produces the 409.
    assert.ok(indexes.includes('idx_restaurants_name_lower'));
  });
});

// --- constraints ------------------------------------------------------------

describe('constraints', () => {
  test('rating outside 0-5 is rejected by the database, not just the API', async () => {
    await inRollback(async (client) => {
      // The case that matters: a write that never sees the Zod schema.
      assert.equal(
        await sqlstate(client, insertRestaurant, ['Bypass High', null, null, 9]),
        '23514',
        'rating 9 should violate the CHECK constraint'
      );
      assert.equal(
        await sqlstate(client, insertRestaurant, ['Bypass Low', null, null, -1]),
        '23514'
      );
    });
  });

  test('the rating boundaries and null are accepted', async () => {
    await inRollback(async (client) => {
      for (const rating of [0, 5, 2.5, null]) {
        assert.equal(
          await sqlstate(client, insertRestaurant, [
            `Boundary ${rating}`,
            null,
            null,
            rating,
          ]),
          null,
          `rating ${rating} should be allowed`
        );
      }
    });
  });

  test('name is required at the database level', async () => {
    await inRollback(async (client) => {
      assert.equal(
        await sqlstate(client, insertRestaurant, [null, null, null, 3]),
        '23502'
      );
    });
  });

  test('duplicate names are rejected, case-insensitively', async () => {
    await inRollback(async (client) => {
      await client.query(insertRestaurant, ['Unique Check', null, null, 3]);

      assert.equal(
        await sqlstate(client, insertRestaurant, [
          'Unique Check',
          null,
          null,
          3,
        ]),
        '23505'
      );
      // Uniqueness cannot be enforced in application code - a "does this exist"
      // query is stale the moment it returns - so this is the check that
      // actually holds under concurrency.
      assert.equal(
        await sqlstate(client, insertRestaurant, [
          'UNIQUE CHECK',
          null,
          null,
          3,
        ]),
        '23505'
      );
    });
  });

  test('a visit cannot reference a restaurant that does not exist', async () => {
    await inRollback(async (client) => {
      assert.equal(
        await sqlstate(
          client,
          `INSERT INTO visits ("restaurantId", date, "amountSpent") VALUES ($1, $2, $3)`,
          [99999999, '2026-01-01', 10]
        ),
        '23503'
      );
    });
  });
});

// --- generated columns ------------------------------------------------------

describe('database-owned fields', () => {
  test('id and created_at are assigned by Postgres, not the client', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO restaurants (name) VALUES ($1) RETURNING id, created_at`,
        ['Owned Fields']
      );

      assert.equal(typeof rows[0].id, 'number');
      assert.ok(rows[0].id > 0);
      assert.ok(rows[0].created_at instanceof Date);
      // Within a minute of now: proves the DEFAULT fired rather than a null.
      assert.ok(Math.abs(Date.now() - rows[0].created_at.getTime()) < 60_000);
    });
  });
});

// --- cascade ----------------------------------------------------------------

describe('ON DELETE CASCADE', () => {
  test('deleting a restaurant also deletes its visits', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query(insertRestaurant, [
        'Cascade Check',
        null,
        null,
        4,
      ]);
      const id = rows[0].id;

      await client.query(
        `INSERT INTO visits ("restaurantId", date, "amountSpent") VALUES ($1, $2, $3)`,
        [id, '2026-01-01', 42.5]
      );

      const before = await client.query(
        'SELECT 1 FROM visits WHERE "restaurantId" = $1',
        [id]
      );
      assert.equal(before.rowCount, 1);

      await client.query('DELETE FROM restaurants WHERE id = $1', [id]);

      // Documented behaviour, not an accident: deleting a restaurant destroys
      // its spending history. See WriteUp.md - ON DELETE RESTRICT with a 409
      // would be the safer call for an app that exists to track spending.
      const afterDelete = await client.query(
        'SELECT 1 FROM visits WHERE "restaurantId" = $1',
        [id]
      );
      assert.equal(afterDelete.rowCount, 0);
    });
  });
});

// --- migration ledger -------------------------------------------------------

describe('migration ledger', () => {
  const dir = path.join(__dirname, '..', 'db', 'migrations');

  test('every migration file is recorded', async () => {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations'
    );
    const recorded = rows.map((r) => r.filename);

    for (const file of files) {
      assert.ok(recorded.includes(file), `${file} was never recorded as applied`);
    }
  });

  test('recorded checksums match the files on disk', async () => {
    const { rows } = await pool.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations'
    );

    for (const row of rows) {
      const sql = fs.readFileSync(path.join(dir, row.filename), 'utf8');
      const actual = crypto.createHash('sha256').update(sql).digest('hex');

      // A mismatch means a migration was edited after being applied, so the
      // database was built from SQL that no longer exists. The runner refuses to
      // continue in that state; this asserts we are not in it.
      assert.equal(actual, row.checksum, `${row.filename} has drifted`);
    }
  });
});

// --- pool limits ------------------------------------------------------------

describe('pool configuration', () => {
  test('a statement timeout is set on every connection', async () => {
    const { rows } = await pool.query<{ statement_timeout: string }>(
      'SHOW statement_timeout'
    );
    assert.notEqual(
      rows[0].statement_timeout,
      '0',
      'no statement timeout - a slow query could hold a connection forever'
    );
  });

  test('a runaway query is cancelled by Postgres rather than hanging', async () => {
    await inRollback(async (client) => {
      // A short local timeout so the test is fast; the mechanism is identical to
      // the 10s default, and the cancel comes from the server either way.
      await client.query("SET LOCAL statement_timeout = '150ms'");

      const code = await sqlstate(client, 'SELECT pg_sleep(5)');
      assert.equal(code, '57014', 'expected query_canceled');
    });
  });

  test('the pool bounds how many connections it will open', async () => {
    const max = (pool as unknown as { options: { max?: number } }).options.max;
    assert.ok(typeof max === 'number' && max > 0, 'pool has no connection cap');
  });
});

// --- row mapping ------------------------------------------------------------

describe('toRestaurant', () => {
  test('converts the types pg actually returns into the published contract', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO restaurants (name, cuisine, address, rating)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, cuisine, address, rating, created_at AS "createdAt"`,
        ['Mapping Check', 'Japanese', '88 Cherry Ln', 4.5]
      );

      // What pg hands back before mapping: NUMERIC as a string, TIMESTAMPTZ as a
      // Date. Returning this raw would not match the contract.
      assert.equal(typeof rows[0].rating, 'string');
      assert.ok(rows[0].createdAt instanceof Date);

      const mapped = toRestaurant(rows[0]);
      assert.equal(typeof mapped.rating, 'number');
      assert.equal(mapped.rating, 4.5);
      assert.match(mapped.createdAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      assert.equal(mapped.name, 'Mapping Check');
    });
  });

  test('preserves null rather than inventing a value', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO restaurants (name) VALUES ($1)
         RETURNING id, name, cuisine, address, rating, created_at AS "createdAt"`,
        ['Null Check']
      );

      const mapped = toRestaurant(rows[0]);
      assert.equal(mapped.cuisine, null);
      assert.equal(mapped.address, null);
      assert.equal(mapped.rating, null);
    });
  });
});
