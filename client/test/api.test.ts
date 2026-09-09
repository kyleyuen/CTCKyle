import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration tests: the API contract, over HTTP, against a real database.
 *
 * Requires a running server and Postgres:
 *   npm run dev          (in another terminal)
 *   npm run test:api
 *
 * These are the tests that would have caught the planted bug. The unit tests
 * cover decisions in isolation; these check that the whole path - route, pool,
 * SQL, mapper - agrees with what CHALLENGE.md publishes. Where the two overlap
 * that is deliberate: a rule can be right in the schema and still wrong in the
 * handler that forgot to call it.
 *
 * Every row created here carries a per-run suffix so a re-run cannot collide
 * with leftovers from the last one, and is deleted afterwards. The suite is
 * additive rather than destructive - it never truncates - so it is safe to run
 * against a database that has data in it.
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const API = `${BASE}/api/restaurants`;

/** Unique per run, so repeated runs don't trip the unique index on name. */
const RUN = Date.now();
const uniqueName = (label: string) => `Test ${RUN} ${label}`;

const created: number[] = [];

interface Restaurant {
  id: number;
  name: string;
  cuisine: string | null;
  address: string | null;
  rating: number | null;
  createdAt: string;
}

function send(method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  });
}

/** Create a restaurant and remember it for cleanup. */
async function create(fields: Record<string, unknown>): Promise<Restaurant> {
  const res = await send('POST', API, fields);
  // Read the body only on failure: a Response body can be consumed once, so
  // putting `await res.text()` in the assertion message - which is evaluated
  // eagerly - would leave nothing for res.json() below.
  if (res.status !== 201) {
    assert.fail(`setup POST failed (${res.status}): ${await res.text()}`);
  }

  const restaurant = (await res.json()) as Restaurant;
  created.push(restaurant.id);
  return restaurant;
}

before(async () => {
  try {
    const res = await fetch(`${BASE}/api/health`);
    assert.ok(res.ok);
  } catch {
    throw new Error(
      `No server responding at ${BASE}. Start it with 'npm run dev', or set TEST_BASE_URL.`
    );
  }
});

after(async () => {
  await Promise.all(created.map((id) => send('DELETE', `${API}/${id}`)));
});

// --- health -----------------------------------------------------------------

describe('health', () => {
  test('liveness answers without touching the database', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });

  test('readiness reports the database is reachable', async () => {
    const res = await fetch(`${BASE}/api/health/ready`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).database, 'up');
  });
});

// --- the contract table -----------------------------------------------------

describe('GET /api/restaurants', () => {
  test('returns 200 and a JSON array', async () => {
    const res = await fetch(API);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()), 'body must be a bare array');
  });
});

describe('GET /api/restaurants/:id', () => {
  test('returns the restaurant in the published shape', async () => {
    const made = await create({
      name: uniqueName('shape'),
      cuisine: 'Japanese',
      address: '88 Cherry Ln',
      rating: 4.8,
    });

    const res = await fetch(`${API}/${made.id}`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as Restaurant;
    assert.deepEqual(Object.keys(body).sort(), [
      'address',
      'createdAt',
      'cuisine',
      'id',
      'name',
      'rating',
    ]);
    // pg hands NUMERIC back as a string and timestamps as Date objects, so
    // these two assertions really check that toRestaurant() was applied.
    assert.equal(typeof body.rating, 'number', 'rating must be a JSON number');
    assert.match(
      body.createdAt,
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/,
      'createdAt must be ISO 8601'
    );
  });

  test('404 for a row that does not exist', async () => {
    assert.equal((await fetch(`${API}/99999999`)).status, 404);
  });

  test('404 - not 400 or 500 - for an id that is not a positive integer', async () => {
    for (const id of ['abc', '-1', '1.5', '0', '99999999999']) {
      assert.equal((await fetch(`${API}/${id}`)).status, 404, `id ${id}`);
    }
  });
});

describe('POST /api/restaurants', () => {
  test('201 with the created record, including the generated id', async () => {
    const made = await create({
      name: uniqueName('create'),
      cuisine: 'Test',
      address: '2 Test St',
      rating: 4.5,
    });
    assert.equal(typeof made.id, 'number');
    assert.equal(made.rating, 4.5);
  });

  test('accepts a body with only the required field', async () => {
    const made = await create({ name: uniqueName('minimal') });
    assert.equal(made.cuisine, null);
    assert.equal(made.rating, null);
  });

  test('400 on an invalid body, and nothing is stored', async () => {
    const rejected = uniqueName('rejected');
    const bad: [string, unknown][] = [
      ['rating above range', { name: rejected, rating: 6 }],
      ['rating below range', { name: rejected, rating: -1 }],
      ['rating as string', { name: rejected, rating: '4.5' }],
      ['missing name', { cuisine: 'Test' }],
      ['blank name', { name: '   ' }],
      ['name not a string', { name: 123 }],
      ['unknown key', { name: rejected, raiting: 4 }],
      ['array body', [1, 2]],
      ['malformed JSON', '{"name":'],
    ];

    for (const [label, body] of bad) {
      assert.equal((await send('POST', API, body)).status, 400, label);
    }

    // The rejected name must not have reached the table.
    const all = (await (await fetch(`${API}?limit=100`)).json()) as Restaurant[];
    assert.ok(!all.some((r) => r.name === rejected), 'rejected body was stored');
  });

  test('409 on a duplicate name, case-insensitively', async () => {
    const name = uniqueName('duplicate');
    await create({ name });

    assert.equal((await send('POST', API, { name })).status, 409);
    assert.equal(
      (await send('POST', API, { name: name.toUpperCase() })).status,
      409
    );
  });
});

describe('PUT /api/restaurants/:id', () => {
  test('200 with the updated record', async () => {
    const made = await create({ name: uniqueName('put'), rating: 2 });

    const res = await send('PUT', `${API}/${made.id}`, {
      name: uniqueName('put updated'),
      cuisine: 'Thai',
      address: '9 Test Rd',
      rating: 3.5,
    });
    assert.equal(res.status, 200);

    const body = (await res.json()) as Restaurant;
    assert.equal(body.id, made.id);
    assert.equal(body.rating, 3.5);
  });

  test('replaces the whole record, so an omitted field becomes null', async () => {
    const made = await create({
      name: uniqueName('replace'),
      cuisine: 'Italian',
      rating: 4,
    });

    const res = await send('PUT', `${API}/${made.id}`, {
      name: uniqueName('replaced'),
    });
    assert.equal(res.status, 200);

    // Full-replacement PUT semantics, deliberately: it is what lets a client
    // clear a field. Documented in WriteUp.md.
    const body = (await res.json()) as Restaurant;
    assert.equal(body.cuisine, null);
    assert.equal(body.rating, null);
  });

  test('404 for a missing row or an unusable id, even with an invalid body', async () => {
    assert.equal((await send('PUT', `${API}/99999999`, { name: 'x' })).status, 404);
    for (const id of ['abc', '-1', '1.5']) {
      assert.equal(
        (await send('PUT', `${API}/${id}`, { rating: 99 })).status,
        404,
        `id ${id}`
      );
    }
  });

  test('400 on an invalid body', async () => {
    const made = await create({ name: uniqueName('put invalid') });
    assert.equal(
      (await send('PUT', `${API}/${made.id}`, { name: 'x', rating: 6 })).status,
      400
    );
    assert.equal(
      (await send('PUT', `${API}/${made.id}`, { cuisine: 'no name' })).status,
      400
    );
  });
});

describe('DELETE /api/restaurants/:id', () => {
  test('204 with no body, then 404 on a repeat', async () => {
    const made = await create({ name: uniqueName('delete') });

    const res = await send('DELETE', `${API}/${made.id}`);
    assert.equal(res.status, 204);
    assert.equal((await res.text()).length, 0, '204 must carry no body');

    assert.equal((await send('DELETE', `${API}/${made.id}`)).status, 404);
  });

  test('404 for an unusable id', async () => {
    for (const id of ['abc', '-1', '99999999']) {
      assert.equal((await send('DELETE', `${API}/${id}`)).status, 404, `id ${id}`);
    }
  });
});

// --- pagination -------------------------------------------------------------

describe('pagination', () => {
  test('400 on parameters outside the contract', async () => {
    const bad = [
      '?limit=0',
      '?limit=101',
      '?limit=abc',
      '?limit=1.5',
      '?after=garbage',
      '?bogus=1',
    ];
    for (const q of bad) {
      assert.equal((await fetch(`${API}${q}`)).status, 400, q);
    }
  });

  test('walks every page with no gaps and no repeats', async () => {
    // Enough rows to need several pages at limit=2. Tracked locally rather than
    // reusing `created`, which by now also holds rows the DELETE test removed.
    const expected: number[] = [];
    for (let i = 0; i < 5; i++) {
      expected.push((await create({ name: uniqueName(`page ${i}`) })).id);
    }

    const seen: number[] = [];
    let url: string | null = `${API}?limit=2`;

    for (let guard = 0; url && guard < 50; guard++) {
      const res: Response = await fetch(url);
      assert.equal(res.status, 200);

      for (const row of (await res.json()) as Restaurant[]) seen.push(row.id);

      const link = res.headers.get('Link');
      url = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }

    assert.equal(new Set(seen).size, seen.length, 'a page repeated a row');
    for (const id of expected) {
      assert.ok(seen.includes(id), `row ${id} was never returned by any page`);
    }
  });

  test('a page never exceeds the requested limit', async () => {
    const rows = (await (await fetch(`${API}?limit=2`)).json()) as Restaurant[];
    assert.ok(rows.length <= 2);
  });
});
