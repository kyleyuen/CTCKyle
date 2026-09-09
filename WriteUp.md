# Write-up

## 1. What did you build for Part B, and why that?

> What made you pick it over everything else you could have built? This is the
> question we care most about - the _why_ matters more than the _what_.
Development is not simply about adding exciting new features. It also means ensuring existing functions are robust and reliable. Because this repository is a scaffold with only a few endpoints and a simple frontend, I chose to strengthen its foundation. My philosophy for Part B was to ensure every error is identified, labeled, and handled correctly. For example, the A1 issue appeared to be a React error at restaurants.map, but its root cause was an unchecked SQL error earlier in the process. Similarly, the existing migration only creates a table if it does not already exist, so adding new columns would not only not update an existing database, 
but also tell the user that the migration have been applied. These issues reveal insufficient error handling and verification beneath the APIs and migrations. Hence, I have opt to build out the foundations to correctly handle these instead of adding on top of it. To combat this, I have created numerous things ranging from error handling, validations of data (API or direct Database connection), pagination., pool handling, migration ledger, 55 tests, CI, and at last api health checks.  

## 2. What did you decide, and what did you rule out?

> Route shapes, data model, where the logic lives, what you deliberately didn't
> do. Name a tradeoff you're not sure you got right.
1. Route shapes: Before pagination, the API will simply return the JSON for every single resturant at one go. With 5 resturants that is completely fine, however, with 100k resturants, that will be slow. Given that we must have to tell the client that there is more data than the current 20 that we are showing, the default way is to wrap it into the JSON by adding some sort of signal to suggest there is more. Our implemntation was slightly scuffed, given that I have to adhere to Part A constraints where it needs to return it as a JSON array, I could not have simply warpped it like I said but instead to include it in the header where the body will stay the exactly the same. 
2. Although my validation already rejects rating outside of 0 to 5, there is more than one way of accessing the database. The seond way is to through psql or a GUI client where they can simply edit anything they want. Hence, I also moved the same set of rules into the database as well wwhere no matter who is writing, the data will be validated and clean. My philosophy behind this is that as long as incoming data is clean, we can always assume the database is therefore also clean. 
3. Logic: I split the logic into two main files: validation.ts and errors.ts. Validation.ts checks whatever comes in from the client and decides whether it is even possible to store, and errors.ts decides what the client is told when something fails. The design philosophy behind this error and validation is that I want to ensure all handle all errors that the client will most likely face with correct messaging and accurate reasoning as to why. Such that when a 500 error does get sent out, it means that there is somethign wrong with our code rather than the user's fault. Everything that the user can get wrong should be handled correctly and given the correct 4xx code. 
4. What I removed: I was originally thinking about caching the databse query instead of asking the API for one every single time. THe reason why I completely scrapped that idea is taht I have realised that the database often updates and hence if someone else added a new user when should we use the cache version vs when should we use the database version? Furthermore, my benchmark showed that the query itself takes 0.3ms while a full round trip through the API takes 4.3ms, which means the database was never the slow part to begin with, so there was nothing there worth optimising. Hence optimizations with batching, caching or other performance otpomizations for this side was scrapped.
5. A trade off: One trade off I am not sure about is that my PUT endpoint replaces the entire record, so whatever the clients sends becomes the new record and any field they leave out is set back to null. I chose it because it is the only way a client can clear a field. If I had gone the other way and treated a missing field as "leave it alone", then a user who deliberately wants to empty the address has no way of saving it, given that not sending it and asking for it to be blank would look identical to the server.

## 3. Where did you cut corners?

> What would you fix first with another day?

---

## Part B: routes

| Method and path | What it does | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/restaurants?limit=&after=` | Lists restaurants, newest first, one page at a time. | `200` + JSON array, plus a `Link` header holding the next page's URL (absent on the last page) | `400` on an invalid `limit`, an unrecognised `after` cursor, or an unknown query parameter |
| `GET /api/health/ready` | Readiness probe: checks the database is reachable. | `200` + `{"status":"ready","database":"up"}` | `503` + `{"status":"unavailable","database":"down"}` |

`limit` is 1-100 and defaults to 20. `after` is an opaque cursor taken from a previous
page's `Link` header - follow it until it stops appearing.

**`GET /api/restaurants?limit=2`**

```jsonc
// 200 response headers
// Link: <http://localhost:3000/api/restaurants?limit=2&after=MjAyNi0wOS0wOVQxODo0MjoyNS42NDgwODZafDQ>; rel="next"

// 200 response body - a bare array, unchanged from the Part A contract
[
  { "id": 5, "name": "Green Bowl", "cuisine": "Vegetarian", "address": "5 Garden Way", "rating": 3.9, "createdAt": "2026-09-09T18:42:25.648Z" },
  { "id": 4, "name": "El Fuego",   "cuisine": "Mexican",    "address": "47 Sol Blvd",   "rating": 4.6, "createdAt": "2026-09-09T18:42:25.648Z" }
]

// 400 response - the same envelope every error in this API uses
{
  "error": "Invalid pagination parameters",
  "code": "VALIDATION_FAILED",
  "details": [{ "field": "limit", "message": "limit must be at most 100" }]
}
```

## Schema changes

Two new migrations, applied by `npm run migrate`. Nothing extra to run.

- `002_unique_restaurant_name.sql` - case-insensitive unique index on
  `restaurants (lower(name))`. This is what returns `409` on a duplicate.
- `003_restaurant_constraints.sql` - `CHECK (rating >= 0 AND rating <= 5)`, and an index
  on `(created_at DESC, id DESC)` that keyset pagination seeks along.

`db/migrate.ts` also creates **`schema_migrations`** (`filename`, `checksum`,
`applied_at`) itself, since it is what records migrations. An existing database adopts
it on the next run, no manual step.

One new dependency: **zod**.

## How I verified this

**Automated - `npm test`, 55 tests across three suites.**

```bash
npm run test:unit   # 19 tests, no database or server needed
npm run test:db     # 17 tests, database only
npm run test:api    # 19 tests, full contract over HTTP
npm test            # all three
```

- `test/unit.test.ts` - id parsing, body validation, cursors, and error-to-status mapping.
- `test/db.test.ts` - constraints, cascade, the migration ledger, and pool limits.
- `test/api.test.ts` - the Part A contract table and pagination, over HTTP.

All of it runs in CI on every push (`.github/workflows/ci.yml`) against a disposable
Postgres, including a step that asserts a second `npm run migrate` is a no-op.

**Part A** - the contract table, every row including the error cases:

```bash
curl -i http://localhost:3000/api/restaurants          # 200 + array
curl -i http://localhost:3000/api/restaurants/1        # 200 + one restaurant
curl -i http://localhost:3000/api/restaurants/99999    # 404
curl -i http://localhost:3000/api/restaurants/abc      # 404, not 500
curl -i http://localhost:3000/api/restaurants/-1       # 404
curl -i http://localhost:3000/api/restaurants/1.5      # 404

curl -i -X POST http://localhost:3000/api/restaurants \
  -H 'Content-Type: application/json' \
  -d '{"name":"Valid Spot","cuisine":"Test","address":"2 Test St","rating":4.5}'  # 201

curl -i -X POST http://localhost:3000/api/restaurants \
  -H 'Content-Type: application/json' -d '{"name":"Out Of Range","rating":6}'     # 400

curl -i -X POST http://localhost:3000/api/restaurants \
  -H 'Content-Type: application/json' -d '{"name":"Valid Spot"}'                  # 409

curl -i -X PUT http://localhost:3000/api/restaurants/1 \
  -H 'Content-Type: application/json' -d '{"name":"Renamed","rating":3.5}'        # 200

curl -i -X DELETE http://localhost:3000/api/restaurants/1                         # 204, no body
```

**Part B**

```bash
# Pagination: follow the Link header until it stops appearing
curl -i 'http://localhost:3000/api/restaurants?limit=2'
curl -i 'http://localhost:3000/api/restaurants?limit=0'        # 400
curl -i 'http://localhost:3000/api/restaurants?limit=101'      # 400
curl -i 'http://localhost:3000/api/restaurants?after=garbage'  # 400
curl -i 'http://localhost:3000/api/restaurants?bogus=1'        # 400, unknown parameter

# Constraints hold for writes that never touch the API
docker compose exec -T db psql -U postgres -d feeding_brennen \
  -c "INSERT INTO restaurants (name, rating) VALUES ('Bypass', 9);"   # rejected, 23514

# The migration ledger: a second run applies nothing
npm run migrate

# Readiness reflects the database; liveness does not
curl -i http://localhost:3000/api/health/ready    # 200, database up
docker compose stop db
curl -i http://localhost:3000/api/health          # still 200 - the process is alive
curl -i http://localhost:3000/api/health/ready    # 503 - correctly refuses traffic
docker compose start db
```

**Benchmark - `npm run bench`.** 100,000 rows, medians over 15 timed runs after warmup.
It rewrites the `restaurants` table, so run `npm run seed` afterwards.

## Known issues / what I'd do next

**Not built, in the order I would add them.**

1. No authentication or authorisation - anyone who can reach the port can delete everything.
2. No structured logging, correlation ids, or error reporting.
3. No PATCH, so a partial PUT body silently nulls what it omits.
4. No concurrency control - two clients editing the same row is last-write-wins.
5. No rate limiting, and no graceful shutdown on SIGTERM.

**Known and deliberate.**

- `ON DELETE CASCADE` from `001` silently destroys a restaurant's visits. Inherited, and
  I think it is the wrong default for an app that tracks spending.
- The `visits` table is still unused - no endpoint reads it.
- `max: 10` and `statement_timeout: 10s` were chosen by judgment, not measurement.
- Default `postgres:postgres` credentials, fine locally and wrong anywhere else.
- Benchmark numbers are dev-mode, one machine, 100k rows that fit in memory.
- The frontend only reads; there is no UI for create, edit, or delete.
