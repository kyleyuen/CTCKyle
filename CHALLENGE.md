# Feeding Brennen - Take-Home Challenge

Welcome! This repo is a deliberately **unfinished** fullstack app for tracking
restaurants, visits, and spending. Your job is to take it from "scaffold" to
"real, usable app."

We care more about how you think than about how much you finish. A focused,
well-built subset beats a sprawling, half-working everything. If you run out of
time, leave notes on what you'd do next.

The challenge comes in two halves:

- **Part A** is prescribed: three tasks, everyone builds the same thing, so we
  can compare submissions fairly.
- **Part B** is wide open. You decide what to build.

## Scope

We're not putting a clock on this - people come to it with very different
starting points, and a number would only mislead half of you. Work at whatever
pace is honest for you.

What we do ask: **don't gold-plate.** If Part B is growing, cut scope rather
than keep building. We would much rather read a small finished feature than a
large broken one, and an unfinished submission with a clear write-up still
tells us plenty.

## Before you start

**Fork this repo to your own GitHub account and keep the repo public** - you'll
work there, and the link to it is what you submit. Then install
[Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it;
the database runs in Docker, so nothing works without it.

Get it running by following **[SETUP.md](./SETUP.md)**: clone your fork, run
`./setup.sh`, then `cd client && npm run dev`. (On Windows, work in WSL2 or Git
Bash - `setup.sh` is a shell script.)

On a fresh clone http://localhost:3000 shows a Next.js error screen reading
`restaurants.map is not a function`. **That's expected, not a broken setup** -
it's the bug in A1 below. Fix it and the page lists the seeded restaurants.
`curl http://localhost:3000/api/health` returning `{"status":"ok"}` is how you
confirm the setup itself is fine.

## What's already done

So you know where the floor is:

- A single Next.js app that serves both the UI and the REST API (route handlers)
- PostgreSQL connection pool, a migration, and a seed script
- `GET /api/restaurants` and `GET /api/restaurants/:id` (route handlers)
- A bare Next.js page that lists restaurants
- A shared error helper for the API (`lib/errors.ts`) - currently a stub
- Shared types and row mappers (`lib/types.ts`) used by both sides of the API

## How it's put together

It's **one Next.js app**. The UI lives in `app/` and the REST API lives in route
handlers under `app/api/`. Those handlers talk to Postgres through the shared
pool in `db/pool.ts`. There is no separate backend server and no Server Actions -
the frontend reaches data only by calling the `/api` endpoints over HTTP, so
building real REST endpoints is the whole job.

**New to this?** [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) walks through it properly:
the request lifecycle end to end, how a URL becomes a route handler, what the
status codes mean, what every file is for, and where to start if you haven't
built a REST API before. **A partial submission is still worth submitting** -
that page says more about why.

---

# Part A: the floor (required)

**Three tasks.** Everyone builds this, and everyone builds it the same way. It's
the part we can grade objectively, so finish it before you touch Part B.

### A1. Fix the bug

`GET /api/restaurants` does not behave correctly. Find out why and fix it. (Hint:
compare the query in the route handler to the migration.) Once fixed, `curl
http://localhost:3000/api/restaurants` should return `200` with a JSON array of
the seeded restaurants, and the frontend list at http://localhost:3000 should
load.

`client/app/api/restaurants/route.ts`, `client/db/migrations/001_create_tables.sql`

### A2. Finish the Restaurant write API

The three write handlers are stubbed and return `501`. Implement all three.

`client/app/api/restaurants/route.ts` (POST),
`client/app/api/restaurants/[id]/route.ts` (PUT, DELETE)

- **`POST /api/restaurants`** -> insert and return the created restaurant with `201`.
- **`PUT /api/restaurants/:id`** -> update and return the record, or `404`.
- **`DELETE /api/restaurants/:id`** -> delete and return `204`, or `404`.

Match the contract table below exactly - including the response shape. Build
your responses with `toRestaurant()` from `lib/types.ts`, the same helper the
read endpoints use; returning a raw database row will not match (Postgres hands
back `rating` as a string and timestamps as `Date` objects).

### A3. Validate input and handle errors

A2 gets the happy path working. This is what makes it finished - an endpoint
that only works on well-formed input isn't done.

`client/app/api/restaurants/` (validation),
`client/lib/errors.ts` (the shared handler)

- **Validate before you touch the database.** Nothing validates anything today;
  most visibly, `rating` accepts any number, including `6`. Decide what valid
  means for each field and reject bad input with a `400`. Required fields and
  types matter as much as ranges.
- **Handle errors in one place.** `lib/errors.ts` is a stub that always returns
  `500`. Make it map known failures to the right status (`400`, `404`, `409`,
  ...) and call it from your `catch` blocks instead of hand-rolling a response
  in every route.
- **Don't leak internals.** No stack traces or raw database errors in responses.
- **Cover the unhappy paths.** Missing records, malformed bodies, wrong types,
  duplicates. None of them should produce a `500`.
- **The two `GET` handlers count too.** They're written, but they're not
  hardened - `GET /api/restaurants/abc` currently returns a `500`, because the
  id goes straight to Postgres and blows up there. The contract below says that
  route answers `404`. Fixing that is part of A3.

### API contract

Part A is a fixed contract. Match it exactly - these status codes are what we
check against.

| Method and path               | Success                                | Errors                                                            |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/restaurants`        | `200` + JSON array                     | -                                                                 |
| `GET /api/restaurants/:id`    | `200` + restaurant                     | `404` if missing _or_ if `:id` isn't a positive integer           |
| `POST /api/restaurants`       | `201` + created restaurant (with `id`) | `400` on invalid body (missing `name`, `rating` outside 0-5, ...) |
| `PUT /api/restaurants/:id`    | `200` + updated restaurant             | `404` if missing, `400` on invalid body                           |
| `DELETE /api/restaurants/:id` | `204`, no body                         | `404` if missing                                                  |

On any `:id` route, an id that isn't a positive integer (`abc`, `-1`, `1.5`)
is a **`404`**, not a `400` - there's no such restaurant, and that's the answer
we check for. A `500` is wrong in every row of this table.

Restaurant shape:

```json
{
  "id": 1,
  "name": "The Rusty Spoon",
  "cuisine": "American",
  "address": "12 Main St",
  "rating": 4.5,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

---

# Part B: ship one thing (wide open)

Feeding Brennen is supposed to track what Brennen spends eating out. Right now
it barely does anything.

**Ship one thing that makes it better.** You decide what. The feature, the
routes, the data shape, the UI - all yours.

There is no list to pick from, no hidden answer we're waiting for, and no
category of work we favor. We give this to a lot of people, and we'd be
disappointed if the submissions all looked alike.

If it helps to get unstuck: use the app for ten minutes, read the schema in
`client/db/migrations/`, and notice what annoys you. But that's one way in, not
a required process - if you already know what you want to build, go build it.

### The only rules

- **Some of it has to be a real API under `/api`.** Route handlers that speak
  HTTP - no Server Actions, no direct DB calls from a page. Beyond that, build
  as much or as little UI as your idea needs.
- **Hold it to the A3 bar:** validated input, sensible status codes, handled
  failures.
- **Document it in `WriteUp.md`** - the routes, the request/response shapes,
  and how to exercise them. We can't review an API we can't find.

You can add migrations, add tables, change the schema, pull in a library - all
fair game. Just say so in `WriteUp.md`.

**One gotcha if you touch the schema:** add a _new_ migration file
(`client/db/migrations/002_your_change.sql`) rather than editing
`001_create_tables.sql`. The runner has no ledger and 001 is written with
`CREATE TABLE IF NOT EXISTS`, so on a database that already has the tables an
edit to 001 is silently skipped - and `npm run migrate` still reports success.
`ALTER TABLE` in an 002 is the way. (Or wipe and rebuild:
`docker compose down -v && ./setup.sh`.)

---

## Your write-up

This goes in `WriteUp.md` at the root of the repo. **A skeleton is already
there - fill it in.** It carries real weight in how we evaluate you; for Part B
it's often the difference between a good submission and a great one. Aim for
**~300 words**, four questions:

1. **What did you build for Part B, and why that?** What made you pick it over
   everything else you could have built? This is the question we care most about.
2. **What did you decide, and what did you rule out?** Route shapes, data model,
   where logic lives, what you deliberately didn't do.
3. **Where did you cut corners?** What would you fix first with another day?
4. **What should we look at first?**

Write it like you're handing the work to a teammate. We'd rather read an honest
"I ran out of time on X and here's what I'd do" than a polished list of
accomplishments.

## Verifying your work

There's no unit-test suite - verify your endpoints yourself against your running
database.

**For Part A**, work through the contract table above and confirm each row -
every status code in it, including the error cases. `curl` is plenty:

```bash
# Reads (work today once the bug is fixed)
curl http://localhost:3000/api/restaurants          # 200 + JSON array
curl http://localhost:3000/api/restaurants/1        # 200 + one restaurant
curl -i http://localhost:3000/api/restaurants/99999 # 404
curl -i http://localhost:3000/api/restaurants/abc   # 404, not 500 (A3)

# Create - should return 201 with the created row
curl -i -X POST http://localhost:3000/api/restaurants \
  -H 'Content-Type: application/json' \
  -d '{"name":"Valid Spot","cuisine":"Test","address":"2 Test St","rating":4.5}'

# Validation - an out-of-range rating should be rejected with 400, not stored
curl -i -X POST http://localhost:3000/api/restaurants \
  -H 'Content-Type: application/json' \
  -d '{"name":"Out Of Range","rating":6}'
```

**For Part B**, walk through the equivalent cases for whatever you built - the
happy path _and_ the failures. Use whatever you like: `curl`, Postman, Insomnia,
a scratch script.

Tell us in `WriteUp.md` how you verified things. That's much faster for us to
review than working it out ourselves, and it's how you show you checked the edge
cases.

## How we evaluate

Two parts, two different questions.

### Part A - did you build it correctly?

Mostly objective - it either matches the contract or it doesn't.

| What we look for        | Means                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Correctness**         | It actually works, including edge cases and the right status codes                                          |
| **Validation & errors** | Bad input is rejected with useful 4xx responses; failures are handled in one place, not leaked              |
| **Edge cases**          | You handled the unhappy paths - bad input, missing records, duplicates - and can show how you verified them |
| **Code quality**        | Readable, consistent, well-organized; no obvious footguns                                                   |

### Part B - did you make good calls?

This is the part we're most interested in.

| What we look for | Means                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Judgment**     | Can you explain why this was worth building? We're judging your reasoning, not whether we'd have picked the same thing |
| **Design**       | Do the routes, request/response shapes, and UI structure hold up? Choices a reviewer would make too                    |
| **Finish**       | Does it actually work end to end, not just on the happy path?                                                          |
| **Write-up**     | Can you justify the call, name your own tradeoffs, and say what you'd do next?                                         |

### What we're **not** grading on

- **How impressive Part B sounds.** A small, finished, well-reasoned feature
  beats an ambitious broken one. Every time.
- Pixel-perfect design or a component library - clean and clear is plenty.
- Volume. We are not counting features or lines of code.

## Submitting

1. **Work in your own public fork** of this repo. Work on a branch and open a
   pull request against your fork, so the diff is easy to read.
2. Fill in **`WriteUp.md`** at the root of the repo. Everything we need to read
   goes in that one file:
   - the write-up (see above),
   - the routes you built for Part B and their request/response shapes,
   - how you verified your work.

   The PR description can just point at it.

3. Push everything to your fork, then **submit the link to your public fork on
   the [submission form](https://forms.gle/sLZHGrs5FQvX4VjHA)**. Open the link in a
   private/incognito window first to confirm the repo is actually public - we
   can't review a fork we can't open.

**Submit even if you didn't finish.** An honest write-up about where you got to
and what you'd do next is worth far more to us than an empty inbox.

Good luck and tell us if anything in the setup fights you. That's useful
feedback too.
