import { NextResponse } from 'next/server';
import { pool } from '@/db/pool';
import { handleError } from '@/lib/errors';
import { toRestaurant } from '@/lib/types';
import { parseBody, restaurantSchema } from '@/lib/validation';

/**
 * GET /api/restaurants
 * Returns all restaurants.
 */
export async function GET() {
  try {
    const { rows } = await pool.query(
      // Suggestion: Columns are listed instead of SELECT * --> Columns added later will not be given by the query.
      // Bug Fix: Original --> "ORDER BY createdAt DESC", Postgres reads createdat (lower cased) where it is not
      // recognized by the database, hence rejecting the entire query. Changed "createdAt" to "created_at". 
      'SELECT id, name, cuisine, address, rating, created_at AS "createdAt" FROM restaurants ORDER BY created_at DESC'
    );
    // Map every row - raw rows don't match the contract (NUMERIC comes back
    // as a string, timestamps as Date objects). See lib/types.ts.
    return NextResponse.json(rows.map(toRestaurant));
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
