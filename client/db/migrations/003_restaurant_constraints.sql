-- Migration 003: make the rules the API enforces true of the table itself.
--
-- Run with: npm run migrate
--
-- The API already rejects a rating outside 0-5, so why say it twice? Because
-- validation only protects requests that come through the API. The seed script,
-- a psql session, a future background job, or a second service all write to this
-- table directly and never see that check. Validation produces a good error
-- message; a constraint produces a guarantee. Different jobs, both wanted.
--
-- NULL is still allowed - the column is nullable and "not rated yet" is a real
-- state. A CHECK passes on NULL, so this bounds the range without making the
-- field required.
--
-- Written as a plain ALTER TABLE, which this project could not support before
-- the migration ledger: every file used to re-run on every migrate, and
-- ADD CONSTRAINT errors the second time. Files run once now, so ordinary SQL
-- works - which is the point of having done the ledger first.

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_rating_range CHECK (rating >= 0 AND rating <= 5);

-- The list endpoint sorts by created_at on every request. At five rows Postgres
-- reads the table and sorts in memory and this changes nothing measurable - it
-- is not a benchmarked speedup and there is nothing here worth benchmarking.
-- It is here so the ordering has a supporting index as the table grows, and
-- because keyset pagination has to seek into this exact order rather than scan
-- and discard. id is the tiebreaker so the order is total: two rows created in
-- the same millisecond still have one defined position, which pagination needs
-- or it will skip or repeat them.
CREATE INDEX IF NOT EXISTS idx_restaurants_created_at
  ON restaurants (created_at DESC, id DESC);
