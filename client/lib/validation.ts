/**
 * The input boundary: everything that inspects untrusted data lives here.
 *
 * Route handlers call into this and get back values they can trust, so nothing
 * downstream has to re-check. Failures throw the error classes from
 * `lib/errors.ts`, which decides the status code in one place.
 *
 * Note the split from `lib/types.ts`: those are TypeScript types, erased at
 * build time and enforcing nothing at runtime. These are runtime checks.
 */
import { z } from 'zod';
import { NotFoundError, ValidationError, type ErrorDetail } from './errors';

/** `restaurants.id` is a 4-byte SERIAL; anything larger overflows in Postgres. */
const MAX_INT4 = 2147483647;

/**
 * Turn a raw `:id` URL segment into a usable id.
 *
 * Returns a number rather than a string so the query never asks Postgres to
 * cast, which is what turned `GET /api/restaurants/abc` into a 500.
 *
 * Per the contract, an id that isn't a positive integer is a 404, not a 400:
 * `abc`, `-1` and `1.5` can't name a row, so "not found" is the honest answer.
 */
export function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new NotFoundError();

  const id = Number(raw);
  if (id < 1 || id > MAX_INT4) throw new NotFoundError();

  return id;
}

/**
 * What a client may send for a restaurant.
 *
 * `strictObject` rejects unknown keys, so a misspelled field (`raiting`) is a
 * 400 rather than a value silently dropped on the floor.
 *
 * `.nullish()` on the optional fields accepts both an omitted key and an
 * explicit null, which is how a client clears a nullable column.
 *
 * Zod already rejects NaN, Infinity and the string "4.5" for `z.number()`.
 * Ratings are not coerced from strings on purpose: a contract that quietly
 * accepts several formats stops being a contract.
 */
export const restaurantSchema = z.strictObject({
  name: z.string().trim().min(1, 'name is required').max(200),
  cuisine: z.string().trim().max(100).nullish(),
  address: z.string().trim().max(300).nullish(),
  rating: z.number().min(0).max(5).nullish(),
});

export type RestaurantInput = z.infer<typeof restaurantSchema>;

/**
 * Read a request body and validate it against `schema`.
 *
 * Covers both ways this fails: a body that isn't valid JSON 
 * and one that parses but doesn't match. Both are the caller's mistake,
 * so both are a 400.
 */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<T> {
  let raw: unknown;

  try {
    raw = await req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
    throw new ValidationError('Invalid request body', details);
  }

  return result.data;
}
