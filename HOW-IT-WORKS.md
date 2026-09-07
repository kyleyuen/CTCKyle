# How this repo works

Orientation for the Feeding Brennen take-home. If you've built a REST API
before, skim this and move on. If you haven't, read it properly - it's the
mental model [CHALLENGE.md](./CHALLENGE.md) assumes.

Setup instructions live in [SETUP.md](./SETUP.md); the tasks themselves live in
[CHALLENGE.md](./CHALLENGE.md).

## One app, two halves

It's **one Next.js app** serving two different things on the same port:

- **The frontend** - the pages in `app/` that render HTML for the browser.
- **The API** - the route handlers in `app/api/` that speak JSON over HTTP.

There is no separate backend server. When people say "the client" and "the
server" here, they mean these two halves, not two programs.

The rule that shapes this challenge: **the frontend only gets data by making
HTTP requests to the API.** It never reaches into the database directly. That's
why building real endpoints is the whole job - if the frontend could just query
Postgres, there'd be nothing to build.

## What happens when you load the page

```
  Browser
     |  GET http://localhost:3000/
     v
  app/page.tsx                      a React Server Component - runs on the
     |                              server, not in the browser
     |  calls getRestaurants()
     v
  lib/apiClient.ts                  fetch() - a real HTTP request, even though
     |                              it's the same app answering it
     |  GET http://localhost:3000/api/restaurants
     v
  app/api/restaurants/route.ts      a route handler - this is "the backend"
     |
     |  pool.query('SELECT ...')
     v
  db/pool.ts                        one shared Postgres connection pool
     |
     v
  PostgreSQL                        running in Docker on port 5432
```

The response travels back up the same path: rows become JSON, JSON becomes a
JavaScript array, the array becomes HTML.

Two things surprise people here. **Server Components run on the server**, so
`page.tsx` does its `fetch` before the browser sees anything - that's why
`apiClient.ts` needs an absolute URL (`http://localhost:3000/...`) instead of
just `/api/restaurants`. And **the app calls itself over HTTP**, which looks
wasteful but is the point: it forces the API to be a real API.

## How a URL becomes code

Next turns folders into routes. Two rules cover everything:

1. **The folder path is the URL.** A file at `app/api/restaurants/route.ts`
   answers requests to `/api/restaurants`. The filename is always literally
   `route.ts` - that's what marks the folder as an endpoint.
2. **The exported function name is the HTTP method.** `export async function
   GET` handles `GET`; `export async function DELETE` handles `DELETE`.

Square brackets mean a dynamic segment: `app/api/restaurants/[id]/route.ts`
matches `/api/restaurants/1`, `/api/restaurants/2`, and so on, handing you the
value as `params.id`.

That's why there are several files called `route.ts` - one per endpoint. The two
under `restaurants/` are different resources: the **collection**
(`/api/restaurants` - list them, add one) and a **single item**
(`/api/restaurants/:id` - read, update, or delete that one). It's why `POST`
lives on the collection, while `PUT` and `DELETE` live on the item.

**The `GET` handlers already in `app/api/restaurants/route.ts` are working
examples of the whole pattern** - query the pool, handle the failure, return
JSON. The stubs you're implementing sit right below them.

## Status codes

REST answers with a number as well as a body. The ones this challenge cares
about:

| Code | Name | Use it when |
| ---- | ---- | ----------- |
| `200` | OK | A read or update succeeded |
| `201` | Created | A `POST` created something new |
| `204` | No Content | It worked and there's nothing to return (a `DELETE`) |
| `400` | Bad Request | The client sent something invalid - reject it |
| `404` | Not Found | No record with that id |
| `409` | Conflict | Valid, but clashes with what's already there |
| `500` | Internal Server Error | *You* broke. Never the right answer to bad input. |

The `4xx` codes mean "you, the caller, did something wrong." `5xx` means "we did
something wrong." Most of A3 is moving failures out of the `500` bucket and into
the right `4xx` one.

## The files

Everything lives in `client/`. Files marked *(you'll edit)* are where the work is.

```
client/
  app/
    page.tsx                     home page - lists restaurants   (you'll edit)
    layout.tsx                   the HTML shell
    api/                         <- the REST API
      health/route.ts            GET /api/health
      restaurants/
        route.ts                 GET, POST /api/restaurants      (you'll edit)
        [id]/route.ts            GET, PUT, DELETE /api/...:id    (you'll edit)
  db/
    pool.ts                      shared Postgres connection
    migrations/001_*.sql         the schema - read this first
    migrate.ts                   `npm run migrate`
    seed.ts                      `npm run seed`
  lib/
    types.ts                     Restaurant/Visit shapes + row mappers
    apiClient.ts                 the frontend's fetch helpers
    errors.ts                    shared error handler - a stub  (you'll edit)
```

## If you're newer to this

**A partial submission is worth submitting.** We would much rather see A1 and a
solid A2 with an honest write-up than nothing at all. Getting stuck somewhere
and explaining where is real signal - it tells us how you think, which is most
of what we're reading for. Don't drop out because you didn't finish.

A few things that will save you time:

- **Read the terminal running `npm run dev`.** Server-side errors print there,
  not in the browser console. Postgres errors in particular are unusually
  helpful - they often name the exact column you got wrong.
- **Start by reading `db/migrations/001_create_tables.sql`.** Every field, type,
  and constraint you're working with is in that one file.
- **Copy the shape of the existing `GET` handlers.** They already do the
  try/catch, the query, and the JSON response. Your new handlers are variations
  on them.
- **Do it in order.** A1 unblocks everything. A2 gives you working endpoints.
  A3 hardens them. Don't start Part B until Part A works.

Worth having open:

- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers) -
  reading a request body, returning a response, dynamic params
- [node-postgres: queries](https://node-postgres.com/features/queries) -
  in particular parameterized queries (`$1`, `$2`), which you should use for
  every value that comes from a request
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)
