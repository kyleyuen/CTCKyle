-- Migration 002: one restaurant per name.
--
-- Run with: npm run migrate
--
-- Why this lives in the database and not only in the API: uniqueness cannot be
-- enforced in application code. A "does this name already exist?" SELECT is
-- stale the moment it returns - two concurrent POSTs both see nothing and both
-- insert. Only the database can decide this, and only at write time. The API
-- turns the resulting 23505 into a 409 (see lib/errors.ts).
--
-- Case-insensitive on purpose: "Sakura House" and "sakura house" are the same
-- restaurant to a human, so they should collide. `name` is already trimmed by
-- the API before it reaches here.
--
-- A unique INDEX rather than a unique CONSTRAINT because `IF NOT EXISTS` works
-- on indexes: the migration runner has no ledger and re-runs every file, so
-- every statement has to be safe to apply twice. It enforces uniqueness
-- identically and raises the same SQLSTATE.

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_name_lower
  ON restaurants (lower(name));
