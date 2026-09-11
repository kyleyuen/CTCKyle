import { NextResponse } from 'next/server';
import { pool } from '@/db/pool';
import { handleError, NotFoundError } from '@/lib/errors';
import { toRestaurant } from '@/lib/types';
import { parseBody, parseId, restaurantSchema } from '@/lib/validation';

type Params = { params: { id: string } };

/**
 * GET /api/restaurants/:id
 * Returns a single restaurant, or 404 if it doesn't exist.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, cuisine, address, rating, created_at AS "createdAt" FROM restaurants WHERE id = $1',
      [parseId(params.id)]
    );

    if (rows.length === 0) {
      throw new NotFoundError();
    }

    return NextResponse.json(toRestaurant(rows[0]));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * PUT /api/restaurants/:id
 * Update an existing restaurant. 200 with the record, 404 if there is no such
 * row, 400 on a bad body.
 *
 * Full replacement, per what PUT means: every client-owned column is set, so an
 * omitted field becomes NULL rather than keeping its old value. That is what
 * lets a form clear a field. PATCH would be the addition for clients that only
 * hold part of the record.
 *
 * The id is checked before the body, so a bad id is a 404 even when the body is
 * also invalid - there is no resource to validate against.
 */
export async function PUT(req: Request, { params }: Params) {
  try {
    const id = parseId(params.id);
    const body = await parseBody(req, restaurantSchema);

    const { rows } = await pool.query(
      'UPDATE restaurants SET name = $1, cuisine = $2, address = $3, rating = $4 WHERE id = $5 RETURNING id, name, cuisine, address, rating, created_at AS "createdAt"',
      [body.name, body.cuisine ?? null, body.address ?? null, body.rating ?? null, id]
    );

    if (rows.length === 0) {
      throw new NotFoundError();
    }

    return NextResponse.json(toRestaurant(rows[0]));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * DELETE /api/restaurants/:id
 * Delete a restaurant. 204 with no body, or 404 if there is no such row.
 *
 * `RETURNING id` is not used in the response - it only distinguishes "deleted a
 * row" from "matched nothing", which saves a SELECT and closes the race between
 * checking and deleting.
 *
 * Note the blast radius: the foreign key in 001 is ON DELETE CASCADE, so this
 * also destroys every visit for that restaurant - the spending history this app
 * exists to keep. See WriteUp.md; ON DELETE RESTRICT with a 409, or a soft
 * delete, would be the safer call.
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { rows } = await pool.query(
      'DELETE FROM restaurants WHERE id = $1 RETURNING id',
      [parseId(params.id)]
    );

    if (rows.length === 0) {
      throw new NotFoundError();
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleError(err);
  }
}
