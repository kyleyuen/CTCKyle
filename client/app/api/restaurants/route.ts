import { NextResponse } from 'next/server';
import { pool } from '@/db/pool';
import { handleError } from '@/lib/errors';
import { toRestaurant } from '@/lib/types';
import { parseBody, restaurantSchema } from '@/lib/validation';
import { encodeCursor, nextLinkHeader, parsePageRequest } from '@/lib/pagination';

/**
 * GET /api/restaurants
 * Newest first, one page at a time. 200 with a JSON array, 400 on bad
 * pagination parameters.
 *
 * `?limit=` (1-100, default 20) and `?after=` (a cursor from a previous page).
 * The body stays a bare array because the API contract fixes it that way, so
 * the next-page link travels in a `Link` header rather than an envelope.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { limit, after } = parsePageRequest(url);

    // Ask for one more row than requested: if it comes back there is another
    // page, and we learn that without a second COUNT query.
    const { rows } = await pool.query(
      // Suggestion: Columns are listed instead of SELECT * --> Columns added later will not be given by the query.
      // Bug Fix: Original --> "ORDER BY createdAt DESC", Postgres reads createdat (lower cased) where it is not
      // recognized by the database, hence rejecting the entire query. Changed "createdAt" to "created_at".
      //
      // The row-value comparison (created_at, id) < ($1, $2) is the keyset seek:
      // it matches idx_restaurants_created_at exactly, so Postgres jumps to the
      // cursor instead of scanning and discarding rows the way OFFSET does.
      `SELECT id, name, cuisine, address, rating, created_at AS "createdAt",
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTs"
         FROM restaurants
        WHERE $1::timestamptz IS NULL
           OR (created_at, id) < ($1::timestamptz, $2::int)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [after?.createdAt ?? null, after?.id ?? null, limit + 1]
    );

    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    // Map every row - raw rows don't match the contract (NUMERIC comes back
    // as a string, timestamps as Date objects). See lib/types.ts. `cursorTs` is
    // dropped here: it exists only to build the cursor, not for the client.
    const restaurants = page.map(toRestaurant);

    const last = page[page.length - 1];
    const headers =
      hasNextPage && last
        ? {
            Link: nextLinkHeader(
              url,
              limit,
              // Deliberately `cursorTs`, not the mapped `createdAt`. The response
              // field is an ISO string at millisecond precision, but the column
              // holds microseconds - so a cursor built from it rounds *down* and
              // the seek then excludes every row sharing that millisecond. The
              // seeded rows all share one timestamp, so this dropped four of
              // five rows before it was caught.
              encodeCursor(String(last.cursorTs), Number(last.id))
            ),
          }
        : undefined;

    return NextResponse.json(restaurants, { headers });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/restaurants
 * Create a new restaurant. 201 with the created record, or 400 on a bad body.
 *
 * `id` and `created_at` are absent from the insert on purpose: Postgres owns
 * them (SERIAL and DEFAULT now()), and accepting either from a client would
 * let someone collide with an existing row or backdate a record.
 */
export async function POST(req: Request) {
  try {
    const body = await parseBody(req, restaurantSchema);
    const { rows } = await pool.query(
      'INSERT INTO restaurants (name, cuisine, address, rating) VALUES ($1, $2, $3, $4) RETURNING id, name, cuisine, address, rating, created_at AS "createdAt"',
      [body.name, body.cuisine ?? null, body.address ?? null, body.rating ?? null]
    );
    return NextResponse.json(toRestaurant(rows[0]), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
