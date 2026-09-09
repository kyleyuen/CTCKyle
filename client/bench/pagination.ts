import { performance } from 'perf_hooks';
import { pool } from '../db/pool';

/**
 * Pagination benchmark.
 *
 * Run with: npm run bench
 *
 * WARNING: this rewrites the `restaurants` table. It truncates, inserts
 * synthetic rows, and truncates again at the end. Run `npm run seed` afterwards
 * to get the sample data back. Do not point it at anything you care about.
 *
 * Why this exists. Every performance claim in the write-up needs a number
 * behind it, and the seeded database has five rows - nothing measurable. This
 * builds a table big enough for the difference between keyset and offset
 * pagination to be visible, then measures it.
 *
 * Method, because a benchmark you cannot trust is worse than none:
 *
 *   - Queries are timed directly against the pool, not through HTTP. A dev-mode
 *     Next server adds compile and render time that has nothing to do with the
 *     query and would drown the signal.
 *   - Every measurement runs WARMUP times first with those results discarded,
 *     so the numbers reflect a warm cache rather than first-touch disk reads.
 *   - Each measurement is repeated and reported as a median plus p95, never a
 *     single sample or a mean. One slow run from an unrelated process should not
 *     move the headline number.
 *   - Both strategies are checked to return the same rows before being compared,
 *     because a fast query returning the wrong answer is not a faster query.
 */

const ROWS = Number(process.env.BENCH_ROWS ?? 100_000);
const PAGE_SIZE = 20;
const WARMUP = 3;
const RUNS = 15;

/** Depths to sample. Offset should degrade across these; keyset should not. */
const DEPTHS = [0, 1_000, 10_000, 50_000, ROWS - PAGE_SIZE * 2];

// --- measurement ------------------------------------------------------------

interface Stats {
  median: number;
  p95: number;
  min: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { median: at(0.5), p95: at(0.95), min: sorted[0] };
}

/** Run `fn` WARMUP times discarded, then RUNS times timed. */
async function measure(fn: () => Promise<unknown>): Promise<Stats> {
  for (let i = 0; i < WARMUP; i++) await fn();

  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  return stats(samples);
}

const ms = (n: number) => `${n.toFixed(2)}ms`.padStart(10);

// --- the two strategies -----------------------------------------------------

const SELECT = `SELECT id, name, cuisine, address, rating, created_at
                  FROM restaurants`;

/** What the endpoint used to do: count rows, then throw them away. */
function offsetPage(offset: number) {
  return pool.query(
    `${SELECT} ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, offset]
  );
}

/** What it does now: seek straight to the cursor. */
function keysetPage(after: { created_at: Date; id: number } | null) {
  return pool.query(
    `${SELECT}
      WHERE $1::timestamptz IS NULL
         OR (created_at, id) < ($1::timestamptz, $2::int)
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [after?.created_at ?? null, after?.id ?? null, PAGE_SIZE]
  );
}

/**
 * The cursor a client would hold at `depth`, found the way a client gets there:
 * by having already read that many rows. Fetching it is not part of any timing.
 */
async function cursorAt(depth: number) {
  if (depth === 0) return null;
  const { rows } = await pool.query(
    `SELECT created_at, id FROM restaurants
      ORDER BY created_at DESC, id DESC
      LIMIT 1 OFFSET $1`,
    [depth - 1]
  );
  return rows[0] ?? null;
}

// --- fixture ----------------------------------------------------------------

async function loadFixture(): Promise<void> {
  console.log(`Loading ${ROWS.toLocaleString()} synthetic rows...`);
  const started = performance.now();

  await pool.query('TRUNCATE visits, restaurants RESTART IDENTITY CASCADE');

  // One statement rather than ROWS inserts: generate_series builds the rows
  // inside Postgres, so this is a single round trip instead of 100,000.
  // created_at is spread one second apart so the sort order is fully distinct,
  // and rating stays inside the 0-5 CHECK from migration 003.
  await pool.query(
    `INSERT INTO restaurants (name, cuisine, address, rating, created_at)
     SELECT 'Bench Restaurant ' || g,
            'Cuisine ' || (g % 20),
            g || ' Bench Street',
            ((g % 51)::numeric / 10),
            now() - (g || ' seconds')::interval
       FROM generate_series(1, $1) AS g`,
    [ROWS]
  );

  await pool.query('ANALYZE restaurants');
  console.log(`  done in ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
}

// --- reports ----------------------------------------------------------------

async function compareStrategies(): Promise<void> {
  console.log('KEYSET vs OFFSET, one page of 20, by depth into the table');
  console.log('  depth        offset      keyset   difference');

  for (const depth of DEPTHS) {
    const cursor = await cursorAt(depth);

    // Correctness gate: a faster query returning different rows is not a faster
    // query. Compare the ids both strategies produce before timing them.
    const offsetIds = (await offsetPage(depth)).rows.map((r) => r.id).join(',');
    const keysetIds = (await keysetPage(cursor)).rows.map((r) => r.id).join(',');
    if (offsetIds !== keysetIds) {
      console.log(
        `  ${String(depth).padStart(6)}  MISMATCH - strategies disagree, not comparable`
      );
      continue;
    }

    const off = await measure(() => offsetPage(depth));
    const key = await measure(() => keysetPage(cursor));
    const factor = off.median / key.median;

    console.log(
      `  ${String(depth).padStart(6)}  ${ms(off.median)}  ${ms(key.median)}   ${factor.toFixed(1)}x`
    );
  }
  console.log();
}

async function showPlans(): Promise<void> {
  const depth = DEPTHS[DEPTHS.length - 1];
  const cursor = await cursorAt(depth);

  console.log(`QUERY PLANS at depth ${depth.toLocaleString()}`);

  const offsetPlan = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS) ${SELECT} ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, depth]
  );
  console.log('  offset:');
  for (const row of offsetPlan.rows) console.log(`    ${row['QUERY PLAN']}`);

  const keysetPlan = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS) ${SELECT}
      WHERE (created_at, id) < ($1::timestamptz, $2::int)
      ORDER BY created_at DESC, id DESC LIMIT $3`,
    [cursor.created_at, cursor.id, PAGE_SIZE]
  );
  console.log('  keyset:');
  for (const row of keysetPlan.rows) console.log(`    ${row['QUERY PLAN']}`);
  console.log();
}

/**
 * Does the index from migration 003 actually earn its place? Drop it, measure
 * again, put it back. Without this the index is an assumption.
 */
async function indexContribution(): Promise<void> {
  const depth = DEPTHS[DEPTHS.length - 1];
  const cursor = await cursorAt(depth);

  const withIndex = await measure(() => keysetPage(cursor));

  await pool.query('DROP INDEX IF EXISTS idx_restaurants_created_at');
  await pool.query('ANALYZE restaurants');
  const withoutIndex = await measure(() => keysetPage(cursor));

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_restaurants_created_at
       ON restaurants (created_at DESC, id DESC)`
  );
  await pool.query('ANALYZE restaurants');

  console.log(`INDEX CONTRIBUTION (keyset at depth ${depth.toLocaleString()})`);
  console.log(`  with idx_restaurants_created_at    ${ms(withIndex.median)}`);
  console.log(`  without it                         ${ms(withoutIndex.median)}`);
  console.log(
    `  factor                             ${(withoutIndex.median / withIndex.median).toFixed(1)}x\n`
  );
}

/**
 * Concurrency through the HTTP layer. These timings include Next's overhead, so
 * they are not comparable to the query numbers above - what they show is whether
 * the pool cap holds up under simultaneous load rather than collapsing.
 */
async function concurrentRequests(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const url = `${base}/api/restaurants?limit=${PAGE_SIZE}`;

  try {
    const probe = await fetch(url);
    if (!probe.ok) throw new Error(String(probe.status));
  } catch {
    console.log('  skipped (no server responding on localhost:3000)\n');
    return;
  }

  for (const concurrency of [1, 10, 50, 100]) {
    const timings: number[] = [];
    const started = performance.now();

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const t0 = performance.now();
        const res = await fetch(url);
        await res.json();
        timings.push(performance.now() - t0);
      })
    );

    const wall = performance.now() - started;
    const s = stats(timings);
    console.log(
      `  ${String(concurrency).padStart(3)} concurrent   median ${ms(s.median)}   p95 ${ms(s.p95)}   wall ${ms(wall)}`
    );
  }
  console.log();
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== Pagination benchmark ===');
  console.log(
    `rows ${ROWS.toLocaleString()} | page ${PAGE_SIZE} | ${WARMUP} warmup + ${RUNS} timed runs, median reported\n`
  );

  await loadFixture();
  await compareStrategies();
  await indexContribution();
  await showPlans();

  console.log('CONCURRENT REQUESTS through the API (includes Next overhead)');
  await concurrentRequests();

  console.log('Cleaning up: truncating the benchmark rows.');
  await pool.query('TRUNCATE visits, restaurants RESTART IDENTITY CASCADE');
  console.log("Run 'npm run seed' to restore the sample data.\n");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Benchmark failed:', err instanceof Error ? err.message : err);
    pool.end().finally(() => process.exit(1));
  });
