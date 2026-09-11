import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseId, parseBody, restaurantSchema } from '../lib/validation';
import { encodeCursor, parsePageRequest } from '../lib/pagination';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  handleError,
} from '../lib/errors';

/**
 * Unit tests: the boundaries, with no database and no server.
 *
 * These cover the logic that decides whether a request is acceptable and what
 * status a failure becomes - which is where the bugs would be. They run in
 * milliseconds and need nothing running, so they can gate every commit; the
 * contract itself is covered by test/api.test.ts against a real database.
 *
 * Node's built-in runner, executed through tsx. No test framework dependency:
 * `node:test` and `node:assert` cover everything needed here.
 */

// --- id parsing -------------------------------------------------------------

describe('parseId', () => {
  test('accepts a positive integer and returns a number', () => {
    assert.equal(parseId('1'), 1);
    assert.equal(parseId('42'), 42);
    // A number, not a string: the query then never asks Postgres to cast, which
    // is what turned /api/restaurants/abc into a 500.
    assert.equal(typeof parseId('7'), 'number');
  });

  test('rejects anything that cannot name a row, as 404 not 400', () => {
    for (const bad of ['abc', '-1', '1.5', '0', '', ' 1', '1e3', '0x10']) {
      assert.throws(
        () => parseId(bad),
        (err: unknown) => err instanceof NotFoundError && err.status === 404,
        `expected ${JSON.stringify(bad)} to be a 404`
      );
    }
  });

  test('rejects ids beyond a 4-byte integer, which would overflow in Postgres', () => {
    assert.equal(parseId('2147483647'), 2147483647);
    assert.throws(() => parseId('2147483648'), NotFoundError);
    assert.throws(() => parseId('99999999999'), NotFoundError);
  });
});

// --- body validation --------------------------------------------------------

const post = (body: unknown) =>
  new Request('http://localhost/api/restaurants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('restaurantSchema', () => {
  test('accepts a full body and trims the name', async () => {
    const parsed = await parseBody(
      post({
        name: '  Sakura House  ',
        cuisine: 'Japanese',
        address: '88 Cherry Ln',
        rating: 4.8,
      }),
      restaurantSchema
    );
    assert.equal(parsed.name, 'Sakura House');
    assert.equal(parsed.rating, 4.8);
  });

  test('treats the optional fields as optional, absent or null', async () => {
    const minimal = await parseBody(post({ name: 'Minimal' }), restaurantSchema);
    assert.equal(minimal.cuisine, undefined);

    const nulled = await parseBody(
      post({ name: 'Nulled', cuisine: null, address: null, rating: null }),
      restaurantSchema
    );
    assert.equal(nulled.rating, null);
  });

  test('accepts the rating boundaries', async () => {
    const zero = await parseBody(post({ name: 'Zero', rating: 0 }), restaurantSchema);
    const five = await parseBody(post({ name: 'Five', rating: 5 }), restaurantSchema);
    assert.equal(zero.rating, 0);
    assert.equal(five.rating, 5);
  });

  test('rejects bad bodies with a 400 naming the field', async () => {
    const cases: [string, unknown][] = [
      ['missing name', { cuisine: 'Test' }],
      ['blank name', { name: '   ' }],
      ['name not a string', { name: 123 }],
      ['name null', { name: null }],
      ['rating above range', { name: 'X', rating: 6 }],
      ['rating below range', { name: 'X', rating: -1 }],
      ['rating as string', { name: 'X', rating: '4.5' }],
      ['unknown key', { name: 'X', raiting: 4 }],
      ['not an object', [1, 2]],
    ];

    for (const [label, body] of cases) {
      await assert.rejects(
        () => parseBody(post(body), restaurantSchema),
        (err: unknown) => err instanceof ValidationError && err.status === 400,
        `expected ${label} to be a 400`
      );
    }
  });

  test('rejects a body that is not valid JSON', async () => {
    await assert.rejects(
      () => parseBody(post('{"name":'), restaurantSchema),
      (err: unknown) =>
        err instanceof ValidationError && /valid JSON/.test(err.message)
    );
  });
});

// --- pagination -------------------------------------------------------------

const listUrl = (query = '') =>
  new URL(`http://localhost/api/restaurants${query}`);

describe('pagination', () => {
  test('defaults to a bounded page when no parameters are given', () => {
    assert.equal(parsePageRequest(listUrl()).limit, 20);
    assert.equal(parsePageRequest(listUrl()).after, undefined);
  });

  test('accepts a limit inside the cap', () => {
    assert.equal(parsePageRequest(listUrl('?limit=1')).limit, 1);
    assert.equal(parsePageRequest(listUrl('?limit=100')).limit, 100);
  });

  test('rejects limits outside the cap or of the wrong shape', () => {
    for (const q of ['?limit=0', '?limit=101', '?limit=-5', '?limit=abc', '?limit=1.5']) {
      assert.throws(
        () => parsePageRequest(listUrl(q)),
        ValidationError,
        `expected ${q} to fail`
      );
    }
  });

  test('rejects unknown query parameters rather than ignoring them', () => {
    assert.throws(() => parsePageRequest(listUrl('?bogus=1')), ValidationError);
  });

  test('round-trips a cursor', () => {
    const cursor = encodeCursor('2026-01-01T00:00:00.000000Z', 42);
    const parsed = parsePageRequest(listUrl(`?after=${cursor}`));
    assert.equal(parsed.after?.id, 42);
    assert.equal(parsed.after?.createdAt, '2026-01-01T00:00:00.000000Z');
  });

  test('preserves microsecond precision through the cursor', () => {
    // The bug this catches: building a cursor from a millisecond ISO string
    // rounds down, and the seek then excludes every row sharing that
    // millisecond - which is every row of a bulk insert.
    const exact = '2026-09-09T18:42:25.648086Z';
    const parsed = parsePageRequest(listUrl(`?after=${encodeCursor(exact, 5)}`));
    assert.equal(parsed.after?.createdAt, exact);
  });

  test('rejects a cursor it did not issue', () => {
    const bad = [
      'garbage',
      encodeCursor('not-a-date', 1),
      encodeCursor('2026-01-01T00:00:00Z', -1),
    ];
    for (const cursor of bad) {
      assert.throws(
        () => parsePageRequest(listUrl(`?after=${cursor}`)),
        ValidationError
      );
    }
  });
});

// --- error mapping ----------------------------------------------------------

describe('handleError', () => {
  test('uses the status the error was thrown with', async () => {
    const cases: [AppError, number, string][] = [
      [new ValidationError('bad'), 400, 'VALIDATION_FAILED'],
      [new NotFoundError(), 404, 'NOT_FOUND'],
      [new ConflictError('clash'), 409, 'CONFLICT'],
    ];

    for (const [err, status, code] of cases) {
      const res = handleError(err);
      assert.equal(res.status, status);
      assert.equal((await res.json()).code, code);
    }
  });

  test('includes field details on a validation failure', async () => {
    const res = handleError(
      new ValidationError('Invalid request body', [
        { field: 'rating', message: 'too big' },
      ])
    );
    assert.equal((await res.json()).details[0].field, 'rating');
  });

  test('maps Postgres SQLSTATE codes to honest statuses', async () => {
    const cases: [string, number][] = [
      ['23505', 409], // unique_violation
      ['23502', 400], // not_null_violation
      ['23514', 400], // check_violation
      ['22P02', 404], // invalid_text_representation
    ];

    for (const [code, status] of cases) {
      const res = handleError(Object.assign(new Error('db'), { code }));
      assert.equal(res.status, status, `SQLSTATE ${code}`);
    }
  });

  test('anything unrecognised is a 500 that leaks nothing', async () => {
    const thrown = [
      new TypeError('x is not a function'),
      'a bare string',
      null,
      { code: 42 },
      Object.assign(new Error('nope'), { code: '99999' }),
    ];

    for (const err of thrown) {
      const res = handleError(err);
      assert.equal(res.status, 500);

      const body = await res.json();
      assert.equal(body.error, 'Internal Server Error');
      assert.equal(body.details, undefined);
      // The response must never carry the original text: a raw Postgres error
      // names tables and constraints, and a stack trace names file paths.
      assert.doesNotMatch(
        JSON.stringify(body),
        /not a function|nope|bare string/
      );
    }
  });
});
