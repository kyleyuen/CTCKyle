# Setup

Get Feeding Brennen running locally. It's a single Next.js app (UI + API) plus a
PostgreSQL database in Docker. Two commands, a few minutes.

## Step 0: use the template repo (use template in the top right)

Before anything else, **use this template to create your own repo**, and leave the repo **public**. You'll work in your fork,
and the link to it is what you hand in on the
[submission form](https://forms.gle/sLZHGrs5FQvX4VjHA). Don't clone this
repo directly - you won't be able to push to it.

## Prerequisites

| Tool                    | Version | Download                                                          | Notes                                                           |
| ----------------------- | ------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Node.js                 | 18+     | [nodejs.org](https://nodejs.org/)                                 | Required                                                        |
| Docker + Docker Compose | 20.10+  | [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Required - runs PostgreSQL.<br>Docker Desktop includes Compose. |

**Install Docker Desktop if you don't already have it**, and **make sure it's
open and running before you start** - the database runs inside it, so nothing
here works without it. The setup script checks for both tools and tells you
what's missing, so you don't have to verify versions by hand.

### On Windows

`setup.sh` is a shell script - it will not run in PowerShell or `cmd.exe`. Run
every command in this repo from a **Unix-style shell**:

- **WSL2** (recommended). Install it with `wsl --install` in an admin
  PowerShell, then work inside the Linux home directory (`~/`), not
  `/mnt/c/...` - Node is dramatically slower across the Windows filesystem
  boundary. In Docker Desktop, turn on **Settings > General > Use the WSL 2
  based engine**, and enable your distro under **Settings > Resources > WSL
  integration** so `docker` works from inside WSL.
- **Git Bash** also works, if you'd rather not set up WSL. Docker Desktop and
  Node are then the Windows installs, and `./setup.sh` runs fine.

Everything after that - `./setup.sh`, `npm run dev`, the `curl` commands in
CHALLENGE.md - is identical to macOS and Linux. If Windows fights you here,
tell us; that's useful feedback.

## Run it

```bash
git clone <your-fork-url> feeding-brennen   # the fork you made in Step 0
cd feeding-brennen
./setup.sh
```

That script starts PostgreSQL in Docker, installs dependencies, creates the
tables, and loads sample data. It's safe to re-run at any point.

Then start the app:

```bash
cd client
npm run dev
```

The app comes up on **http://localhost:3000** - that serves both the UI and the
REST API (under `/api`). Sanity check it:

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

### What you should see before you've fixed anything

**http://localhost:3000 will show a Next.js error screen reading
`restaurants.map is not a function`. That is expected - your setup is fine.**

That's the planted bug in Part A1 surfacing. `/api/restaurants` returns a `500`,
the home page gets an error object instead of an array, and calling `.map` on it
throws. The error points at `app/page.tsx`, but the page is not where the bug
is - the failing query is in the route handler. Fix A1 and the page renders the
seeded restaurants.

Anything else - `/api/health` not returning `{"status":"ok"}`, a connection
error, a blank terminal - is a real setup problem. See Troubleshooting below.

## Expected URLs

| What         | URL                                   |
| ------------ | ------------------------------------- |
| App (UI)     | http://localhost:3000                 |
| API base     | http://localhost:3000/api             |
| Health check | http://localhost:3000/api/health      |
| Restaurants  | http://localhost:3000/api/restaurants |

---

## What the setup script did

You don't need this to get started - it's here so nothing is a black box.

| Step                 | Command                          | Why                                                                                                      |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Start the database   | `docker compose up -d`           | Runs PostgreSQL 16 on `localhost:5432`, pre-configured with the right user, password, and database name. |
| Install dependencies | `npm install` (in `client/`)     | Standard.                                                                                                |
| Create tables        | `npm run migrate` (in `client/`) | Applies `client/db/migrations/*.sql`. Prints `Applied 1 migration(s).`                                   |
| Load sample data     | `npm run seed` (in `client/`)    | Loads 5 restaurants and 3 visits. Prints `Seeded 5 restaurants and 3 visits.`                            |

Run any of them individually whenever you need to - re-seed after you've made a
mess of the data, re-migrate after you add a migration.

Useful database commands:

```bash
docker compose down       # stop the DB (your data is kept)
docker compose down -v    # stop the DB and wipe all data (fresh start)
docker compose logs db    # tail database logs
docker compose ps         # check status - `db` should say "Up ... (healthy)"
```

## Configuration (you probably don't need this)

There is **no `.env` to set up**. The app defaults to the database that
`docker compose` starts, so the standard setup needs no configuration at all.

If you do need to point somewhere else - a different port, or a Postgres you
manage yourself - create `client/.env` (see `client/.env.example`):

| Variable              | Default                                                         | What it's for                                                                                          |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`        | `postgresql://postgres:postgres@localhost:5432/feeding_brennen` | Used by the API route handlers and the migrate/seed scripts.                                           |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3000`                                         | The origin the frontend uses to call the app's own API. Change it only if you run on a different port. |

---

## Troubleshooting

### `Cannot connect to the Docker daemon` / "Docker is installed but not running"

Docker Desktop isn't running. Open it, wait for the whale icon to settle, then
re-run `./setup.sh`.

### `connection refused` / `ECONNREFUSED ... 5432`

The app can't reach PostgreSQL.

- Check the container: `docker compose ps` should show `db` with a status like
  `Up 2 minutes (healthy)`. If not, `docker compose up -d` and check
  `docker compose logs db`.
- If you set a custom `DATABASE_URL`, confirm its host and port match where
  Postgres is actually listening.

### Docker: port 5432 already allocated

Another Postgres (often a native install) already owns port 5432, so the
container can't bind it. Either stop the other one (e.g.
`brew services stop postgresql@16`), or remap the container: change the `ports`
line in `docker-compose.yml` to `"5433:5432"`, then create `client/.env` with a
`DATABASE_URL` using port `5433`.

### Docker: `container name ... is already in use`

A container from another copy of this repo is still around - you cloned it
twice, or renamed the folder. Docker won't start a second one with the same
name.

Remove the old container (the message names it) and re-run setup:

```bash
docker rm -f <container-name>
./setup.sh
```

Note this is a _different_ problem from the port conflict above, even though
both stop the database from starting. Read the Docker error text to tell them
apart: "port is already allocated" vs. "container name ... already in use".

### Port already in use (`EADDRINUSE` on 3000)

Something is already listening on 3000.

- Find and stop it: `lsof -i :3000`, then `kill <PID>`.
- Or run on another port: `npm run dev -- -p 3001`, and set
  `NEXT_PUBLIC_API_URL=http://localhost:3001` in `client/.env`.

### Starting over with a clean database

Wipe the container's data and rebuild from scratch:

```bash
docker compose down -v
./setup.sh
```

### `relation "restaurants" already exists`

The tables are already there. Migrations use `IF NOT EXISTS`, so this is safe to
ignore. To start genuinely fresh, see "starting over" above.

### My schema change didn't apply / `column ... does not exist`

You probably edited `001_create_tables.sql`. That won't work on a database that
already has the tables: the statements are `IF NOT EXISTS`, so Postgres skips
them and `npm run migrate` still prints `Applied 1 migration(s).` as if it
worked.

Put schema changes in a **new** file - `002_your_change.sql` with an
`ALTER TABLE` - and re-run `npm run migrate`. (Or, if you'd rather rewrite 001,
wipe the database first: `docker compose down -v && ./setup.sh`.)

### Really can't run Docker?

As a last resort, install PostgreSQL natively, create a database with
`createdb feeding_brennen`, and point `DATABASE_URL` at it in `client/.env`.
Then run `npm install`, `npm run migrate`, and `npm run seed` in `client/`
yourself. This isn't the supported path - reviewers run the Docker setup - so
only do this if Docker truly isn't an option.
