-- Migration 001: create the core tables for Feeding Brennen.
--
-- Run with: npm run migrate
--
-- Read this file first - every field, type, and constraint you're working with
-- is here.
--
-- Changing the schema? Add a NEW file (002_your_change.sql) rather than editing
-- this one. These statements are `IF NOT EXISTS`, so on a database that already
-- has the tables an edit here is silently skipped - and `npm run migrate` still
-- reports success. See db/migrate.ts.

CREATE TABLE IF NOT EXISTS restaurants (
  id         SERIAL PRIMARY KEY,
  name       TEXT    NOT NULL,
  cuisine    TEXT,
  address    TEXT,
  rating     NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visits (
  id           SERIAL PRIMARY KEY,
  "restaurantId" INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date         DATE    NOT NULL,
  "amountSpent" NUMERIC(10, 2),
  notes        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_restaurant_id ON visits ("restaurantId");
