import { getRestaurants } from '@/lib/apiClient';

// Server component. Fetches restaurants on each request and renders a plain
// list. There is no loading state, no empty state, and no error handling: if
// the API is down or returns something unexpected, this throws.
export default async function HomePage() {
  const restaurants = await getRestaurants();

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium">Restaurants</h2>
      <ul className="space-y-3">
        {restaurants.map((restaurant) => (
          <li
            key={restaurant.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{restaurant.name}</span>
              <span className="text-sm text-gray-500">
                {restaurant.rating}★
              </span>
            </div>
            <div className="mt-1 text-sm text-gray-600">
              {restaurant.cuisine} · {restaurant.address}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
