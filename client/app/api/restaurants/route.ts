import { NextResponse } from 'next/server';
import { pool } from '@/db/pool';
import { handleError } from '@/lib/errors';
import { toRestaurant } from '@/lib/types';

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
 * Create a new restaurant.
 *
 * TODO (A2): implement. Read the restaurant fields from the request body,
 * insert a row, and return the created restaurant with a 201 status.
 *
 * TODO (A3): validate before you insert. Nothing validates anything today, so
 * `rating` happily accepts 6. Decide what valid means for each field and reject
 * bad bodies with a 400 rather than letting them reach the database.
 */
export async function POST(_req: Request) {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
