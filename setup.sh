#!/usr/bin/env bash
#
# One-command setup for Feeding Brennen.
#
#   ./setup.sh
#
# Starts PostgreSQL in Docker, installs dependencies, and creates + seeds the
# database. Safe to re-run: every step is idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# --- pretty output -----------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=''; RED=''; GREEN=''; DIM=''; RESET=''
fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$1"; }
die()  { printf '\n%serror:%s %s\n\n' "$RED" "$RESET" "$1" >&2; exit 1; }

# --- 1. prerequisites --------------------------------------------------------

step "Checking prerequisites"

command -v node >/dev/null 2>&1 \
  || die "Node.js is not installed. Install Node 18+ from https://nodejs.org/"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node 18+ is required (you have $(node --version)). Upgrade at https://nodejs.org/"
fi
ok "node $(node --version)"

command -v docker >/dev/null 2>&1 \
  || die "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/"

docker compose version >/dev/null 2>&1 \
  || die "Docker Compose is not available. Update to a recent Docker Desktop, which bundles it."

docker info >/dev/null 2>&1 \
  || die "Docker is installed but not running. Open Docker Desktop, wait for it to start, then re-run ./setup.sh"
ok "docker $(docker --version | sed 's/Docker version //; s/,.*//')"

# --- 2. database -------------------------------------------------------------

step "Starting PostgreSQL (docker compose up -d)"

if ! docker compose up -d; then
  die "Could not start PostgreSQL. Two things usually cause this - read the
       Docker error printed just above to tell them apart:

         'port is already allocated'  -> something else owns port 5432, often a
             native Postgres. Stop it (e.g. 'brew services stop postgresql@16')
             or remap the port in docker-compose.yml.

         'container name ... already in use'  -> a container from another copy
             of this repo is still around. Remove it with
             'docker rm -f <name>' (the name is in the message above).

       Both are covered in SETUP.md > Troubleshooting."
fi

printf '%s  waiting for the database to accept connections...%s\n' "$DIM" "$RESET"
for _ in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres -d feeding_brennen >/dev/null 2>&1; then
    DB_READY=1
    break
  fi
  sleep 2
done

[ "${DB_READY:-}" = "1" ] || die "PostgreSQL did not become ready in time.
       Check the logs with 'docker compose logs db', then re-run ./setup.sh"
ok "database is up on localhost:5432"

# --- 3. dependencies ---------------------------------------------------------

step "Installing dependencies (npm install)"
printf '%s  the first install usually takes 1-2 minutes...%s\n' "$DIM" "$RESET"
(cd client && npm install --no-fund --no-audit)
ok "dependencies installed"

# --- 4. schema + sample data -------------------------------------------------

step "Creating tables (npm run migrate)"
(cd client && npm run --silent migrate)

step "Loading sample data (npm run seed)"
(cd client && npm run --silent seed)

# --- done --------------------------------------------------------------------

printf '\n%sSetup complete.%s Start the app with:\n\n' "$BOLD" "$RESET"
printf '    cd client && npm run dev\n\n'
printf 'Then open %shttp://localhost:3000%s - the UI and the API both live there.\n' "$BOLD" "$RESET"
printf 'Next: read CHALLENGE.md.\n\n'
