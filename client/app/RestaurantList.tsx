'use client';

import { useState } from 'react';
import { getRestaurants } from '@/lib/apiClient';
import type { Restaurant } from '@/lib/types';

/**
 * The list, plus a button that follows the API's pagination cursor.
 *
 * This is a client component because loading more is a user interaction that
 * has to keep state between renders - which page we are on, and everything
 * fetched so far. The first page still comes from the server component that
 * renders this, so the page has content before any JavaScript runs; only the
 * "load more" path needs the browser.
 *
 * It talks to the API over HTTP like any other client would. No Server Actions
 * and no database access from the page - the rule that makes the endpoints real.
 */
export default function RestaurantList({
  initialItems,
  initialCursor,
}: {
  initialItems: Restaurant[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;

    setLoading(true);
    setError(null);
    try {
      const page = await getRestaurants({ after: cursor });
      // Append rather than replace: the cursor moves forward, so each page is
      // the next slice, not a new view of the same data.
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      // getRestaurants throws on a non-2xx, so this is a real failure rather
      // than an error object quietly rendered as data.
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        No restaurants yet.
      </p>
    );
  }

  return (
    <div>
      <ul className="space-y-3">
        {items.map((restaurant) => (
          <li
            key={restaurant.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{restaurant.name}</span>
              <span className="text-sm text-gray-500">
                {restaurant.rating === null ? 'unrated' : `${restaurant.rating}★`}
              </span>
            </div>
            <div className="mt-1 text-sm text-gray-600">
              {[restaurant.cuisine, restaurant.address]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Absent once the cursor runs out, which is how the API says there is no
          next page - no count of total rows is needed, or fetched. */}
      {cursor && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="mt-4 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}
