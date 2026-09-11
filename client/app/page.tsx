import { getRestaurants } from '@/lib/apiClient';
import RestaurantList from './RestaurantList';

/**
 * Server component: fetches the first page on each request and hands it to the
 * client component, which owns everything after that.
 *
 * Splitting it this way means the list is rendered HTML before any JavaScript
 * loads, and only the "load more" interaction needs the browser. The first page
 * and every later one come from the same endpoint, so there is one definition
 * of what a page is.
 */
export default async function HomePage() {
  let page;
  try {
    page = await getRestaurants();
  } catch (err) {
    // getRestaurants now throws on a non-2xx instead of handing back an error
    // object typed as data - which is how the A1 bug reached this component as
    // "restaurants.map is not a function". Showing the failure beats rendering
    // a broken list.
    return (
      <div>
        <h2 className="mb-4 text-lg font-medium">Restaurants</h2>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err instanceof Error ? err.message : 'Could not load restaurants'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium">Restaurants</h2>
      <RestaurantList
        initialItems={page.items}
        initialCursor={page.nextCursor}
      />
    </div>
  );
}
