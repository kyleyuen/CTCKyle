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

// We read a base URL from the environment because Server Components fetch on
// the server, where relative URLs don't resolve - so we need an absolute origin.
// It's the same app on the same port, so this is normally just localhost:3000.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

/**
 * Fetch every restaurant from the API.
 *
 * NOTE: this is a bare fetch with no error handling. It does not check the
 * response status and it does not catch network failures - callers get whatever
 * `res.json()` produces, including on a 500.
 */
export async function getRestaurants(): Promise<Restaurant[]> {
  const res = await fetch(`${API_URL}/api/restaurants`, { cache: 'no-store' });
  return res.json();
}

/**
 * Fetch a single restaurant by id.
 */
export async function getRestaurant(id: number | string): Promise<Restaurant> {
  const res = await fetch(`${API_URL}/api/restaurants/${id}`, { cache: 'no-store' });
  return res.json();
}
