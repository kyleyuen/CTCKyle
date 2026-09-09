/**
 * The client side of the API: helpers the frontend uses to call the endpoints.
 *
 * Don't confuse this with `app/api/`, which is the other side of the same
 * boundary - the route handlers that *implement* those endpoints. This file
 * only ever talks to them over HTTP.
 *
 * The shapes these helpers return live in `lib/types.ts`, shared with the
 * handlers that produce them.
 */
import type { Restaurant } from './types';

// Server Components fetch on the server, where a relative URL has no origin to
// resolve against, so they need an absolute one. In the browser the opposite is
// true: a relative URL is correct, and hardcoding localhost:3000 would break the
// moment this ran anywhere else.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const origin = () => (typeof window === 'undefined' ? API_URL : '');

/**
 * One page of results plus the cursor for the next one, or null at the end.
 *
 * The API returns a bare JSON array - the contract fixes it that way - so the
 * cursor arrives in an RFC 8288 `Link` header rather than the body. Unpacking it
 * here means callers deal in a page object and never parse headers.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * The status check the original version was missing.
 *
 * `res.json()` parses a 500's error body just as happily as a 200's, so without
 * this a failed request returns an error object typed as data. That is exactly
 * how the planted A1 bug reached the page as `restaurants.map is not a
 * function`: the real fault was four layers upstream and nothing in between
 * noticed. Failing here keeps the error near its cause.
 */
async function ok(res: Response, what: string): Promise<void> {
  if (res.ok) return;

  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body?.error) detail = body.error;
  } catch {
    // A non-JSON error body is not worth failing over; the status already says
    // enough to act on.
  }
  throw new Error(`Could not ${what}: ${detail}`);
}

/** Read the next page's cursor out of the Link header, if there is one. */
function nextCursorFrom(res: Response): string | null {
  const link = res.headers.get('Link');
  if (!link) return null;

  const url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  return url ? new URL(url).searchParams.get('after') : null;
}

/**
 * Fetch one page of restaurants, newest first.
 *
 * Pass the previous page's `nextCursor` as `after` to continue; omitting it
 * starts from the beginning.
 */
export async function getRestaurants(
  options: { limit?: number; after?: string } = {}
): Promise<Page<Restaurant>> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.after) params.set('after', options.after);

  const query = params.toString();
  const res = await fetch(
    `${origin()}/api/restaurants${query ? `?${query}` : ''}`,
    { cache: 'no-store' }
  );
  await ok(res, 'load restaurants');

  return { items: await res.json(), nextCursor: nextCursorFrom(res) };
}

/** Fetch a single restaurant by id. */
export async function getRestaurant(id: number | string): Promise<Restaurant> {
  const res = await fetch(`${origin()}/api/restaurants/${id}`, {
    cache: 'no-store',
  });
  await ok(res, `load restaurant ${id}`);

  return res.json();
}
