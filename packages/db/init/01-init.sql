-- Extensions on the main database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy / typo-tolerant matching
CREATE EXTENSION IF NOT EXISTS unaccent;   -- available for later; see docs/phases/phase-02-database.md S6
                                           -- for why the search path does NOT depend on it

-- Integration tests run against a separate database so a test truncation can
-- never wipe the dev data you were just looking at in the browser.
CREATE DATABASE bitedrop_test OWNER bitedrop;
\connect bitedrop_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
