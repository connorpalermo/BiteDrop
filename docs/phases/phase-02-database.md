# Phase 02 — Database + real reads

| | |
|---|---|
| **Status** | Planned |
| **Planned** | 2026-09-18 |
| **Completed** | — |
| **Commits** | — |

**Goal.** The same UI from Phase 1, rendered from Postgres instead of an in-memory
array — real schema, real migrations, keyset pagination in SQL, full-text search,
and facets — with **no component file changed**.

**Non-goals.** Ingestion (`apps/ingest`, real feeds, populating `raw_item` from the
network) · deployment (Phase 3) · dedupe logic (Phase 6) · trending *computation*
(Phase 9 — Phase 2 seeds the column and reads it) · LLM (Phase 8) · auth, wishlists,
view counts (Phase 11) · the agent (Phase 12+) · image mirroring (Phase 9) ·
redesigning anything visual.

> **This document is a specification, not a sketch.** Every table, column, query,
> file path, and literal an implementer needs is stated here rather than left to
> judgment. Where this document and an older doc disagree, **this document wins**
> and the older doc gets updated (see S18). If something is genuinely ambiguous,
> that is a defect in this document — **stop and ask rather than inventing an
> answer.**

---

## Plan

### The one idea

Phase 1 built the seam on purpose. `FoodDropRepository` in
`packages/core/src/repository.ts` is an interface; `MockFoodDropRepository` is one
implementation; the entire web app talks only to the interface, obtained from a
single file.

Phase 2 adds a second implementation, `PgFoodDropRepository`, and repoints that one
file. **If this phase ends with a diff touching any file under
`apps/web/components/`, `apps/web/app/`, or `apps/web/lib/` other than
`lib/repository.ts`, something went wrong** — not "we improved things along the
way", but *wrong*, because the whole point of Phase 1's criterion 15 was to make
this a swap.

The Phase 1 mock stays. It is still what `packages/core`'s unit tests run against,
and it is still the zero-dependency path.

### What "the same UI" has to mean, concretely

After the swap, `http://localhost:3000` must render the same 40 drops, in the same
order, with the same filters, the same counts in the sidebar, and the same detail
pages as Phase 1. That is only true if the seed is derived from the Phase 1 mock
data rather than re-authored — which is why S7 forbids hand-writing new fixtures.

This gives a free, powerful correctness check: **any visible difference between the
mock-backed feed and the Postgres-backed feed is a bug in the SQL.**

---

## Implementation spec

### S1 — Dependencies and the `packages/db` scaffold

Add exactly these packages. Pin majors; use the latest stable patch.

| Package | Major | Where | Why |
|---|---|---|---|
| `drizzle-orm` | 0.44+ | `packages/db` | the ORM (settled decision) |
| `drizzle-kit` | 0.31+ | `packages/db` (dev) | schema diff → `.sql` migrations |
| `postgres` | 3 | `packages/db` | **postgres.js** — the standard driver (invariant 13) |

**Do not install `@neondatabase/serverless`, `pg`, `@vercel/postgres`, `prisma`, or
`kysely`.** Invariant 13 and architecture §9 rule 1 are explicit: a Neon-specific
driver couples every query path to one host. `postgres.js` over plain TCP works on
Neon, on Docker, and on anything else.

`packages/db/package.json`:

```json
{
  "name": "@bitedrop/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./seed": "./src/seed/index.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.44.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Wire the new package into the three places that need to know about it:

1. **`tsconfig.base.json`** — add to `paths`:
   ```json
   "@bitedrop/db": ["packages/db/src/index.ts"],
   "@bitedrop/db/seed": ["packages/db/src/seed/index.ts"]
   ```
2. **`tsconfig.json`** (root) — add the same two entries to its `paths` (TypeScript's
   `extends` does **not** merge `paths`; Phase 1 learned this the hard way — see
   phase-01 Decisions), and add to `include`:
   `"packages/db/src/**/*.ts"`, `"packages/db/test/**/*.ts"`.
3. **`apps/web/next.config.ts`** — `transpilePackages: ['@bitedrop/core', '@bitedrop/db']`.

Also add `"@bitedrop/db": "*"` to `apps/web/package.json` dependencies.

**Dependency direction is one-way and enforced:** `packages/db` imports from
`packages/core`. `packages/core` must **never** import from `packages/db` — the
interface lives in core, implementations live outside it (CLAUDE.md → Interface
contracts). This is acceptance criterion 20, checked by grep.

### S2 — Docker Compose, extensions, and the test database

Create `docker-compose.yml` at the repo root, exactly as specified in
[`../03-local-dev.md`](../03-local-dev.md):

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: bitedrop-postgres
    environment:
      POSTGRES_USER: bitedrop
      POSTGRES_PASSWORD: bitedrop
      POSTGRES_DB: bitedrop
    ports: ['5433:5432']
    volumes:
      - bitedrop-pgdata:/var/lib/postgresql/data
      - ./packages/db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U bitedrop -d bitedrop']
      interval: 3s
      timeout: 3s
      retries: 20

volumes:
  bitedrop-pgdata:
```

Port **5433**, not 5432 — deliberate, so a Homebrew Postgres on the host does not
collide.

`packages/db/init/01-init.sql` — runs once, on first container start:

```sql
-- Extensions on the main database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy / typo-tolerant matching
CREATE EXTENSION IF NOT EXISTS unaccent;   -- available for later; see S6 for why
                                           -- the search path does NOT depend on it

-- Integration tests run against a separate database so a test truncation can
-- never wipe the dev data you were just looking at in the browser.
CREATE DATABASE bitedrop_test OWNER bitedrop;
\connect bitedrop_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

> **Landmine.** Init scripts run **only when the data volume is empty.** If you edit
> this file after the container has already started once, nothing happens. Re-run
> with `docker compose down -v` (destroys the volume) and `docker compose up -d`.
> Every "CREATE EXTENSION did not run" report is this.

`.env.example` (create it) and your local `.env.local`:

```bash
DATABASE_URL=postgresql://bitedrop:bitedrop@localhost:5433/bitedrop
TEST_DATABASE_URL=postgresql://bitedrop:bitedrop@localhost:5433/bitedrop_test
NODE_ENV=development
LOG_LEVEL=debug
```

`.env.local` must be gitignored; `.env.example` must be committed and stay current.

### S3 — Config module

`packages/db/src/config.ts`. Zod-validated, fails fast and loudly at startup —
architecture doc, and CLAUDE.md → Naming and types.

```ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
});

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid database configuration:\n${z.prettifyError(parsed.error)}\n` +
        `Copy .env.example to .env.local and set DATABASE_URL.`,
    );
  }
  return parsed.data;
}
```

Take `env` as a parameter with a default rather than reading `process.env` inline —
that is what makes it testable without mutating global state.

### S4 — The Drizzle schema

Files under `packages/db/src/schema/`, one concern per file, all re-exported from
`packages/db/src/schema/index.ts`:

```
enums.ts        the pgEnums
reference.ts    category · country · retailer
raw.ts          source · fetch_run · raw_item
canonical.ts    brand · brand_alias · food_drop
joins.ts        food_drop_source · food_drop_country · food_drop_retailer · food_drop_merge
index.ts        re-exports
```

#### S4.1 — Scope: which tables exist after this phase

Create **every table in [`../02-data-model.md`](../02-data-model.md) above the
"User + agent layer" heading**, and none below it.

That means: `source`, `fetch_run`, `raw_item`, `brand`, `brand_alias`, `category`,
`country`, `retailer`, `food_drop`, `food_drop_source`, `food_drop_country`,
`food_drop_retailer`, `food_drop_merge`.

**Do not create** `app_user`, `wishlist_item`, `user_preference`, `agent_run`,
`agent_conversation`, or `ai_pick` — those are Phase 11+ and the data model doc
explicitly sketches them for later.

Two of the created tables (`fetch_run`, `brand_alias`, `food_drop_merge`) are not
read by anything in Phase 2. They are included anyway because they are part of one
already-designed, coherent schema unit, and splitting them across two migrations
buys nothing but a second migration. They will be empty after seeding; that is
correct, not a bug.

#### S4.2 — Enums

```ts
export const sourceType = pgEnum('source_type', [
  'rss', 'json_api', 'html_listing', 'reddit', 'youtube',
]);
export const fetchStatus = pgEnum('fetch_status', [
  'success', 'partial', 'error', 'skipped_not_modified',
]);
export const itemStage = pgEnum('item_stage', [
  'discovered', 'candidate', 'rejected', 'extracted', 'linked', 'failed',
]);
export const dropStatus = pgEnum('drop_status', [
  'new', 'coming_soon', 'limited_time', 'returning', 'discontinued', 'rumored',
]);
export const sourceRole = pgEnum('source_role', ['primary', 'corroborating']);
export const linkMethod = pgEnum('link_method', [
  'exact_url', 'content_hash', 'name_brand', 'fuzzy', 'llm', 'manual',
]);
export const retailerType = pgEnum('retailer_type', [
  'grocery', 'convenience', 'pharmacy', 'mass', 'restaurant', 'online',
]);
```

`drop_status`'s members must be **exactly** `dropStatusSchema`'s members in
`packages/core/src/schemas.ts`, in the same order. A mismatch is a silent
runtime failure at the boundary. Assert it in a test (S15).

`item_stage`'s members beyond `discovered`/`candidate` are provisional — Phase 4
owns the pipeline and may revise them. Noted so nobody treats them as settled.

#### S4.3 — Columns

Transcribe the DDL in [`../02-data-model.md`](../02-data-model.md) faithfully into
Drizzle, with these **four deliberate changes**, each of which must also be
back-ported into `02-data-model.md` (see S18):

1. **`food_drop.short_description text NOT NULL`** — new column. The data model doc
   has only `description`, but `FoodDropSummary.shortDescription` (≤140 chars, what
   the card renders) is a distinct field from `FoodDropDetail.description` (full
   prose). Deriving one by truncating the other is lossy and produces mid-word cuts
   on cards. This is a genuine gap in the older doc, found by checking the schema
   against the domain type — exactly the audit phase-01's Review notes asked for.
2. **`food_drop.description`** is `text NOT NULL DEFAULT ''` rather than nullable.
   `FoodDropDetail.description` is `string`, not `string | null`.
3. **`food_drop.search_text`** holds text that is already **lowercased and
   diacritic-stripped** by application code. See S6 for why this beats
   `unaccent()` in the generated column.
4. **`source.name`** gains `UNIQUE`. The seed resolves publications by name, and
   without the constraint a re-run could create duplicate sources.

Everything else — column names, types, nullability, defaults, `CHECK`s, foreign
keys and their `ON DELETE` behaviour — comes from `02-data-model.md` verbatim.
Column names are `snake_case` in SQL and `camelCase` in TypeScript; Drizzle's first
argument is the SQL name and the object key is the TS name. Do not rename either.

#### S4.4 — The three things Drizzle will not write for you

These are the parts most likely to end up silently missing. **Generate the
migration, then open the `.sql` file and confirm all three are in it.** If
drizzle-kit did not emit one, hand-edit the migration — migrations are committed,
reviewable `.sql` by design (architecture §7), and editing a generated one is
normal, not a workaround.

**(a) The generated `tsvector` column.** Drizzle has no built-in `tsvector` type;
define one with `customType`:

```ts
import { customType } from 'drizzle-orm/pg-core';

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

// on food_drop:
searchVector: tsvector('search_vector')
  .generatedAlwaysAs(sql`to_tsvector('english', search_text)`),
```

**(b) GIN indexes with operator classes.** `gin_trgm_ops` is not the default
operator class and must be named explicitly, or the index is created but never
used by a `%` similarity query.

**(c) Partial index predicates.** Every feed index carries
`WHERE published AND merged_into_id IS NULL`. Dropping the predicate still produces
a working query and a *wrong* index — larger than it needs to be, and not the one
`02-data-model.md` justified. This is the failure mode with no visible symptom,
which is why S15 requires a test that asserts the indexes exist by name.

The complete required index list, from `02-data-model.md` plus the raw layer:

```sql
-- feed + sort
CREATE INDEX food_drop_feed_idx      ON food_drop (first_seen_at DESC, id DESC)
  WHERE published AND merged_into_id IS NULL;
CREATE INDEX food_drop_trending_idx  ON food_drop (trending_score DESC, id DESC)
  WHERE published AND merged_into_id IS NULL;
-- filters (each composite ends in the sort key)
CREATE INDEX food_drop_category_idx  ON food_drop (category_id, first_seen_at DESC)
  WHERE published AND merged_into_id IS NULL;
CREATE INDEX food_drop_brand_idx     ON food_drop (brand_id, first_seen_at DESC)
  WHERE published AND merged_into_id IS NULL;
CREATE INDEX food_drop_status_idx    ON food_drop (status, first_seen_at DESC)
  WHERE published AND merged_into_id IS NULL;
-- search + fuzzy
CREATE INDEX food_drop_search_idx     ON food_drop USING gin (search_vector);
CREATE INDEX food_drop_name_trgm_idx  ON food_drop USING gin (normalized_name gin_trgm_ops);
CREATE INDEX brand_normalized_trgm_idx ON brand USING gin (normalized_name gin_trgm_ops);
-- join lookups
CREATE INDEX food_drop_country_lookup_idx ON food_drop_country (country_code, food_drop_id);
CREATE INDEX food_drop_source_raw_idx     ON food_drop_source (raw_item_id);
-- raw layer
CREATE INDEX raw_item_url_hash_idx     ON raw_item (url_hash);
CREATE INDEX raw_item_content_hash_idx ON raw_item (content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX raw_item_queue_idx        ON raw_item (stage, discovered_at)
  WHERE stage IN ('discovered', 'candidate');
CREATE INDEX fetch_run_source_time_idx ON fetch_run (source_id, started_at DESC);
```

Invariant 6 says every index exists for a named query. The names above are the ones
`02-data-model.md` already justified; do not add a fourteenth without writing down
the query it serves.

### S5 — Migrations

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

Migrations are **generated, then committed, then applied** — never applied via
`drizzle-kit push`. `push` skips the reviewable `.sql` artefact, which is the entire
reason Drizzle was chosen over Prisma (architecture §7).

The migration runner, `packages/db/src/migrate.ts`, uses
`drizzle-orm/postgres-js/migrator`'s `migrate()`. It must run against whatever
`DATABASE_URL` points at, so the same code path migrates dev and test.

### S6 — Pure helpers in `packages/core`

New file `packages/core/src/normalize.ts`, exported from `src/index.ts`. Pure
functions, no I/O — invariant 4. These live in core, not db, because the ingestion
pipeline (Phase 4+) needs the identical normalisation and neither should depend on
the other.

```ts
/** Lowercase + strip diacritics. The shared normalisation both sides of every
 *  text comparison must agree on. */
export function normalizeText(value: string): string;

/** Dedupe/trigram key for a product or brand name: normalizeText, then strip
 *  punctuation, then collapse whitespace. */
export function normalizeName(value: string): string;

/** Builds food_drop.search_text. Fields are joined with a space and normalised
 *  as a whole. Order is name, brand, subcategory, description, retailers —
 *  unweighted in Phase 2 (see Known limitations). */
export function composeSearchText(input: {
  name: string;
  brandName: string | null;
  subcategory: string | null;
  description: string;
  retailerNames: string[];
}): string;

/** Turns a user's raw search box input into a to_tsquery('english', …) string.
 *  Returns null when there is nothing searchable left after sanitising. */
export function buildTsQuery(search: string): string | null;
```

`buildTsQuery` is the one with real rules, so they are spelled out:

1. `normalizeText` the input.
2. Replace every character that is not `[a-z0-9 ]` with a space. **This is the
   injection guard** — no `&`, `|`, `!`, `(`, `)`, `:`, `*`, or quote can survive
   into the tsquery string. Parameterisation alone does not protect you here,
   because the tsquery string is itself a mini-language that Postgres parses.
3. Split on whitespace, drop empties.
4. If no tokens remain, return `null` (caller treats it as "no search filter").
5. Append `:*` to the **last** token only, then join all tokens with ` & `.

Step 5 is what preserves Phase 1's behaviour for a partially-typed word: searching
`pick` must still find "Pickle Lemonade". Plain FTS would not match, because
`pick` and `pickl` are different stems. Prefix-matching only the final token is the
standard "search-as-you-type" shape — prefixing every token would make `taco bell`
match `tacos belly` and friends.

**Why diacritics are handled in TypeScript, not by `unaccent()`:** a Postgres
generated column may only call `IMMUTABLE` functions, and `unaccent()` is `STABLE`
(it reads a dictionary). Using it in the `search_vector` expression fails at
`CREATE TABLE` time with a confusing error, and the usual workaround is wrapping it
in a hand-rolled `IMMUTABLE` SQL function — a lie about immutability that breaks if
the dictionary ever changes. Normalising on both write (`composeSearchText`) and
read (`buildTsQuery`) is simpler, needs no extension at query time, is unit-testable
without a database, and keeps one normalisation rule shared with the dedupe code
that Phase 6 will need.

### S7 — The seed

`packages/db/src/seed/`. **Derive every row from the Phase 1 mock data. Do not
hand-author new fixtures, and do not write a random generator** (Phase 1 S13 rule 4
still applies, for the same reason: a reviewable feed is the point).

```ts
import { CATEGORIES, COUNTRIES, RETAILERS } from '@bitedrop/core';
import { RAW_MOCK_DROPS, sourcesFor } from '@bitedrop/core/mock';
```

The seed is a **single transaction**, and it is **idempotent**: it truncates first,
so running it twice leaves the database in the same state as running it once
(invariant 8's spirit). Order matters — FKs are checked even inside a transaction.

1. `TRUNCATE ... RESTART IDENTITY CASCADE` over every table in S4.1.
2. **`category`** — from `CATEGORIES`, `sort_order` = array index.
3. **`country`** — from `COUNTRIES`.
4. **`retailer`** — from `RETAILERS`, with `type` from the map below.
5. **`brand`** — the distinct non-null `brand` values across `RAW_MOCK_DROPS`;
   `normalized_name = normalizeName(name)`.
6. **`source`** — the distinct `sourceName`s across every drop's `sourcesFor(...)`
   output (there are 8), with `type` from the map below, `slug` = kebab-cased name,
   `url` = the publication base URL, `trust_tier` 2.
7. **`raw_item`** — one row per `SourceRef` of every drop. See the landmine below.
8. **`food_drop`** — one per `RawMockDrop`.
9. **`food_drop_country`**, **`food_drop_retailer`**, **`food_drop_source`**.
10. Backfill `source_count` and `last_source_at` from the rows actually inserted in
    step 9 — not from `RawMockDrop.sourceCount` — then **assert they match** the
    mock's `sourceCount`. A denormalised column that disagrees with its own join
    table is the bug class invariant 11 exists to prevent; catching it in the seed
    is free.

Leave **`fetch_run`, `brand_alias`, and `food_drop_merge` empty.** Nothing reads
them in Phase 2.

Retailer types (from phase-01 S2, which is the source of truth for this list):

```
target·mass  walmart·mass  costco·mass  kroger·grocery  cvs·pharmacy
walgreens·pharmacy  seven_eleven·convenience  circle_k·convenience
amazon·online  mcdonalds·restaurant  taco_bell·restaurant  wendys·restaurant
burger_king·restaurant  starbucks·restaurant  dunkin·restaurant
chick_fil_a·restaurant
```

Source types, for the 8 publications in `packages/core/src/mock/data.ts`:

```
Brand Eating·rss  PR Newswire·rss  The Takeout·rss  Foodbeast·rss
Delish·rss  Eater·rss  r/snackexchange·reddit  YouTube·youtube
```

> **Landmine — `raw_item` URLs collide.** `sourcesFor()` returns the publication's
> *base* URL for every source it generates, so all ~12 "Brand Eating" sources across
> the dataset share the URL `https://www.brandeating.com/`. Inserting those directly
> violates `UNIQUE (source_id, url_hash)` and the seed dies partway through step 7.
> This is a property of the Phase 1 mock helper, not a mistake you made.
> **Fix:** synthesise a unique, deterministic path per raw item —
> `new URL(\`${drop.slug}-${index}\`, sourceRef.url).toString()` — and compute
> `url_hash = sha256(url)` from the synthesised URL with `node:crypto`. These are
> placeholder URLs standing in for articles that do not exist yet; Phase 4 replaces
> them with real ones.

> **Landmine — everything must be published.** `food_drop.published` defaults to
> `false` (invariant 10), and every feed index and query filters on
> `published AND merged_into_id IS NULL`. A seed that does not set
> `published: true` produces a schema that is correct, a seed that reports success,
> and **an empty feed**. Set it explicitly.

Per-drop field mapping, where it is not a rename:

| `food_drop` column | value |
|---|---|
| `normalized_name` | `normalizeName(drop.name)` |
| `search_text` | `composeSearchText({...})` with the drop's resolved retailer names |
| `published` | `true` |
| `first_seen_at` | `drop.firstSeenAt` |
| `trending_score` | `drop.trendingScore` (seeded, not computed — Phase 9 computes) |
| `view_count` | `0` |
| `confidence` | `drop.confidence` |
| `merged_into_id` | `null` |

`food_drop_country.is_primary` is `true` for the **first** entry of
`drop.countryCodes` and false for the rest — the domain type documents countries as
"ordered, primary first", and that ordering has to survive into a set-valued table
that has no inherent order.

`food_drop_source.role` is `'primary'` where `SourceRef.isPrimary`, else
`'corroborating'`; `link_method` is `'manual'` for all seeded rows (they were not
matched by any algorithm), `link_confidence` `1.0`.

IDs are database-generated (`gen_random_uuid()`). Do **not** try to derive stable
UUIDs from the mock's string ids — nothing depends on id stability, and tests
must key off `slug`, which is stable and human-readable.

### S8 — `PgFoodDropRepository`: the file split

All SQL lives under `packages/db/src/repositories/` and nowhere else (invariant 1).
Split it this way **from the start** — the three query methods plus their row
mappers comfortably exceed the 400-line `max-lines` limit in one file, and splitting
under lint pressure later produces arbitrary halves rather than a real
responsibility boundary (CLAUDE.md → Size and structure):

```
packages/db/src/repositories/
  foodDropRepository.ts   the class; implements FoodDropRepository; delegates
  feedQuery.ts            list()  — filters, cursor, ordering
  dropDetail.ts           getBySlug() — the drop, its sources, its related drops
  facetQuery.ts           facets()
  childLoaders.ts         batched countries + retailers for a set of drop ids
  rowMappers.ts           SQL row → FoodDropSummary / SourceRef
```

`foodDropRepository.ts`:

```ts
export class PgFoodDropRepository implements FoodDropRepository {
  constructor(private readonly db: Database) {}
  list(q: FeedQuery): Promise<Page<FoodDropSummary>> { /* → feedQuery.ts */ }
  getBySlug(slug: string): Promise<FoodDropDetail | null> { /* → dropDetail.ts */ }
  facets(): Promise<Facets> { /* → facetQuery.ts */ }
}
```

The connection lives in `packages/db/src/client.ts` and is a **module-level
singleton**:

```ts
const globalForDb = globalThis as unknown as { __bitedropDb?: Database };

export function getDb(): Database {
  globalForDb.__bitedropDb ??= createDb(loadDbConfig().DATABASE_URL);
  return globalForDb.__bitedropDb;
}
```

The `globalThis` stash is not superstition: Next's dev server re-evaluates modules on
every hot reload, and a plain module-level `const` creates a fresh connection pool
each time until Postgres refuses new connections. `createDb(url)` stays exported and
parameterised so tests can build an isolated client against `TEST_DATABASE_URL`.

### S9 — `list()`: exact semantics

The filter semantics are **unchanged from phase-01 S4** — OR within a facet, AND
across facets, absent/empty means no constraint. They are re-stated here only where
SQL makes them non-obvious.

**Base predicate, on every query without exception:**

```sql
WHERE fd.published AND fd.merged_into_id IS NULL
```

**Shape:**

```sql
SELECT fd.*, c.slug AS category_slug, b.slug AS brand_slug, b.name AS brand_name
FROM food_drop fd
JOIN category c ON c.id = fd.category_id
LEFT JOIN brand b ON b.id = fd.brand_id
WHERE fd.published AND fd.merged_into_id IS NULL
  AND <filters>
  AND <cursor predicate>
ORDER BY <sort>
LIMIT $limit + 1
```

`JOIN category` (inner — `category_id` is `NOT NULL`), `LEFT JOIN brand`
(`brand_id` is nullable, and a drop with no brand must still appear).

**Filters:**

| facet | predicate |
|---|---|
| `categories` | `c.slug = ANY($n)` |
| `statuses` | `fd.status = ANY($n)` |
| `brandSlugs` | `b.slug = ANY($n)` |
| `countries` | `EXISTS (SELECT 1 FROM food_drop_country fdc WHERE fdc.food_drop_id = fd.id AND fdc.country_code = ANY($n))` |
| `search` | see below |

`countries` must be `EXISTS`, **not** a join. A drop with three matching countries
joined three times appears three times in the result, which silently corrupts both
the page size and the cursor. This is the single easiest way to break this query.

**Search:**

```sql
AND (
  fd.search_vector @@ to_tsquery('english', $tsq)
  OR similarity(fd.normalized_name, $normalized) > 0.3
)
```

`$tsq` is `buildTsQuery(search)`; when it returns `null`, **omit the entire search
clause** rather than passing an empty string. `$normalized` is
`normalizeName(search)`. The trigram arm is the typo-tolerant fallback the
architecture doc promises (`Oreo` ↔ `Oero`); `0.3` is `pg_trgm`'s default threshold
and is fine until measured otherwise.

**Sort and cursor.** Both sorts are descending with `id` descending as tiebreak, so
the ordering is total and the cursor is unambiguous:

| `sort` | ORDER BY | cursor predicate | cursor `v` |
|---|---|---|---|
| `newest` | `fd.first_seen_at DESC, fd.id DESC` | `(fd.first_seen_at, fd.id) < ($v::timestamptz, $id::uuid)` | `first_seen_at` as ISO string |
| `trending` | `fd.trending_score DESC, fd.id DESC` | `(fd.trending_score, fd.id) < ($v::real, $id::uuid)` | `trending_score` as number |

Use Postgres **row comparison** — `(a, b) < (c, d)` — not the hand-expanded
`a < c OR (a = c AND b < d)`. Both are correct; the row form is what the planner
matches against the composite index, and it is harder to get wrong.

Reuse `encodeCursor` / `decodeCursor` from `packages/core/src/repository.ts`
unchanged. A malformed cursor must still throw `InvalidCursorError` — do not catch
it and fall back to page one (phase-01 S4).

**`nextCursor`, and the `LIMIT $limit + 1` trick.** Fetch one row more than
requested. If `rows.length > limit`, there is a next page: drop the extra row,
return `limit` items, and encode the cursor from the **last returned** item. If
`rows.length <= limit`, `nextCursor` is `null`.

This reproduces the mock's behaviour exactly, including the case the naive
implementation gets wrong: a final page holding exactly `limit` items must return
`nextCursor: null`, not a cursor that leads to an empty page. It also avoids a
`COUNT(*)`, which would double the query cost to learn one boolean.

**Query budget: 3.** One for the page, one batched countries lookup, one batched
retailers lookup — `WHERE food_drop_id = ANY($1)` over the page's ids (S8
`childLoaders.ts`). Never a query per row (CLAUDE.md → Avoiding N+1 queries). If
the page is empty, skip both child queries and return early: 1 query.

### S10 — `getBySlug()`: exact semantics and query budget

Returns `null` for an unknown slug, for an unpublished drop, and for a tombstoned
one (`merged_into_id IS NOT NULL`) — the same base predicate as `list()`. The page
calls `notFound()` on `null` and already handles it.

`sources`, ordered primary first then oldest-discovered first:

```sql
SELECT ri.id, s.name AS source_name, ri.title, ri.url,
       ri.published_at, ri.discovered_at,
       (fds.role = 'primary') AS is_primary
FROM food_drop_source fds
JOIN raw_item ri ON ri.id = fds.raw_item_id
JOIN source   s  ON s.id  = fds.source_id
WHERE fds.food_drop_id = $1
ORDER BY (fds.role = 'primary') DESC, ri.discovered_at ASC
```

`relatedBySameBrand` and `relatedBySameCategory` are each **≤ 4**
`FoodDropSummary`s, excluding the drop itself, ordered `first_seen_at DESC`, under
the same base predicate. When `brand_id IS NULL`, `relatedBySameBrand` is `[]`
without issuing a query.

> **Landmine — the related drops are the N+1 trap in this phase.** Each related
> drop is a full `FoodDropSummary`, so each one needs its countries and retailers.
> Loading those per related drop turns one detail page into up to 18 queries.
> **Load the children for the main drop and all related drops in one pass:** collect
> `[mainId, ...brandRelatedIds, ...categoryRelatedIds]` and hand that single array
> to the same `childLoaders.ts` batch functions `list()` uses.

**Query budget: 6**, constant regardless of how many related drops come back — main
row, related-by-brand, related-by-category, batched countries, batched retailers,
sources.

### S11 — `facets()`: exact semantics

Counts are over the **entire published, non-tombstoned set** and are **unaffected
by the current query** — phase-01 S4, so the sidebar counts do not shift as filters
are applied.

Four queries, one per facet. Each is a `GROUP BY` + `COUNT(*)`:

- **categories** — group by `category_id`; then map over the canonical `CATEGORIES`
  array so all 11 appear, with `count: 0` for any that are absent.
- **countries** — `JOIN food_drop_country`, group by `country_code`; then map over
  the canonical `COUNTRIES` array, same zero-filling. A drop in two countries counts
  once in each — that is correct, and it means the country counts sum to more than
  40.
- **statuses** — group by `status`; map over the canonical `STATUSES` array.
- **brands** — `JOIN brand`, group by brand. **Only brands that actually appear**,
  no zero-filling, ordered `count DESC, name ASC`.

The zero-filling and label lookup already exist as `buildFacetCounts` in
`packages/core/src/mock/repository.ts`. Do **not** import it from `mock/` into
`packages/db` — that would recreate the coupling Phase 1's criterion 15 removed.
Either duplicate the seven lines or promote it to `packages/core/src/reference.ts`
and have both call it. Promoting is preferred; it is one shared *rule* (how a facet
list is assembled), not incidentally-similar text.

### S12 — Row mapping: the type landmines

The driver's JavaScript types do not match the domain types. Every one of these
produces a runtime bug that `tsc` will not catch, because the boundary is untyped.

| Column type | postgres.js gives | Domain type wants | Do this |
|---|---|---|---|
| `timestamptz` | `Date` | ISO `string` | `.toISOString()` |
| `date` | `Date` (default) | `'YYYY-MM-DD'` string | declare `date(..., { mode: 'string' })` in the schema |
| `real` / `double precision` | `number` | `number` | fine |
| `bigint` / `bigserial` | `string` | — | not read in Phase 2 |
| `smallint` | `number` | `number` | fine |
| `uuid` | `string` | `string` | fine |
| `numeric` | `string` | — | **not used**; prices are `integer` cents |

The `date` one is the subtle one: a `Date` for `2026-09-15` built in a
`UTC-05:00` timezone stringifies to `2026-09-14`, so a drop's release date silently
moves a day earlier for anyone west of Greenwich. `mode: 'string'` keeps it a plain
calendar date, which is what the column means and what `formatDropDate` expects.

**Enforce this with Zod rather than by reading carefully.** The schemas already
exist. In the integration tests (S15), parse results through
`foodDropSummarySchema` / `foodDropDetailSchema` — that catches a `Date` where a
`string` belongs, a missing field, and a `shortDescription` over 140 chars, all at
once. This is the "validate external data at the boundary" rule from CLAUDE.md
applied to the boundary that actually exists now.

Do **not** parse with Zod in the production read path. The database is inside the
trust boundary and the schema constrains it; re-validating every row on every
request is the noise CLAUDE.md → Errors warns about. Tests are where the assertion
belongs.

### S13 — Wiring `apps/web`

The whole web-app diff for this phase:

```ts
// apps/web/lib/repository.ts
import type { FoodDropRepository } from '@bitedrop/core';
import { getDb, PgFoodDropRepository } from '@bitedrop/db';

export const repository: FoodDropRepository = new PgFoodDropRepository(getDb());
```

Plus `transpilePackages` and the `package.json` dependency from S1. **Nothing else
under `apps/web/` may change.**

`app/page.tsx`, `app/drops/[slug]/page.tsx`, and `app/actions/feed.ts` already
`await` the repository methods and already handle `null` — they need no edit. If one
of them appears to, re-read S9–S12: the mismatch is in the SQL layer.

Two runtime notes:

- Every caller is already a Server Component or a Server Action, so the driver never
  reaches the browser. Do not add `'use client'` anywhere, and do not create an API
  route to fetch data — that would add an HTTP hop between two things in the same
  process.
- `app/page.tsx` is a dynamic route (it reads `searchParams`). It stays dynamic.
  Do not add `export const revalidate` or `unstable_cache` in this phase; caching a
  feed is a Phase 3 deployment concern and caching it now would mask query-cost
  problems this phase is supposed to surface.

### S14 — Scripts

Root `package.json`:

```json
{
  "dev": "npm run db:up && npm run db:migrate && npm run db:seed && npm run dev -w @bitedrop/web",
  "db:up": "docker compose up -d --wait",
  "db:down": "docker compose down",
  "db:migrate": "tsx packages/db/src/migrate.ts",
  "db:generate": "drizzle-kit generate --config packages/db/drizzle.config.ts",
  "db:seed": "tsx packages/db/src/seed/run.ts",
  "db:reset": "docker compose down -v && npm run db:up && npm run db:migrate && npm run db:seed",
  "db:studio": "drizzle-kit studio --config packages/db/drizzle.config.ts",
  "test": "vitest run",
  "test:unit": "vitest run --project core",
  "check": "tsc --noEmit && eslint . && prettier --check ."
}
```

`docker compose up -d --wait` blocks until the healthcheck passes — that is what
makes the chained `npm run dev` reliable rather than racy. Add `tsx` and `dotenv` as
root dev dependencies; the CLI entrypoints (`migrate.ts`, `seed/run.ts`) load
`.env.local` themselves.

`npm run dev` producing a working, seeded app from one command is the property
`03-local-dev.md` calls out as worth protecting. Verify it from a clean state
(`npm run db:reset` first) before declaring this phase done.

### S15 — Required tests

Vitest gains two projects so unit tests still run without Docker:

- **`core`** — `packages/core/test/**` — unchanged, plus `normalize.test.ts`.
- **`db`** — `packages/db/test/**` — integration, against real Postgres at
  `TEST_DATABASE_URL`. **No mocked database** (`03-local-dev.md`): it tests the
  mock, and every interesting bug here is a constraint or query-plan bug.

The db project's setup file migrates `bitedrop_test`, seeds it once, and — if it
cannot connect — fails with a message naming `npm run db:up`, not a raw
`ECONNREFUSED`. Truncate-and-reseed between files, not between tests; the seed is
read-only as far as these tests are concerned.

**`packages/core/test/normalize.test.ts`**
- `normalizeText` lowercases and strips diacritics (`Crème` → `creme`).
- `normalizeName` additionally strips punctuation (`Reese's` → `reeses`).
- `composeSearchText` includes name, brand, subcategory, description, retailers,
  and is fully normalised.
- `buildTsQuery`: single token → `token:*`; multi-token → `a & b:*`; strips every
  tsquery metacharacter (`&`, `|`, `!`, `(`, `)`, `:`, `*`, `'`); returns `null` for
  `''`, `'   '`, and `'!!!'`.

**`packages/db/test/schema.test.ts`**
- `drop_status` enum members in the database equal `dropStatusSchema.options`, in
  order. Same for the category slugs and country codes in the seeded reference
  tables versus `CATEGORIES` / `COUNTRIES`.
- Every index named in S4.4 exists — query `pg_indexes`, assert by name.
- The three feed indexes are **partial**: their `indexdef` contains
  `WHERE (published AND (merged_into_id IS NULL))`.

**`packages/db/test/feedQuery.test.ts`** — the Phase 1 repository contract, now
against SQL. Port every case from phase-01 S12's `repository.test.ts`:
- default `list` returns `PAGE_SIZE` items, newest first;
- paging to the end accumulates 40 ids with **no duplicates and no gaps**, and the
  union equals the full published set;
- `nextCursor === null` exactly on the final page (and on a final page holding
  exactly `PAGE_SIZE` items — the `LIMIT+1` case);
- a malformed cursor rejects with `InvalidCursorError`;
- each single-facet filter narrows correctly;
- two values in one facet behave as **OR**; two facets behave as **AND**;
- `sort: 'trending'` orders by `trendingScore` descending;
- a multi-country drop appears **once**, not once per country (the `EXISTS` guard);
- `getBySlug` returns `null` for an unknown slug, and `sources.length === sourceCount`.

**`packages/db/test/search.test.ts`**
- whole-word match on name; match on brand name; match on description;
- prefix match (`pick` finds "Pickle …") — the `:*` rule;
- multi-word is AND, not OR;
- diacritic-insensitive both ways (`creme` finds `Crème`, `Crème` finds `creme`);
- a one-character typo still matches via the trigram arm;
- `''` and `'   '` behave as no filter and return the full set.

**`packages/db/test/facets.test.ts`**
- all 11 categories, 9 countries, 6 statuses present, including zero counts;
- category counts sum to 40; country counts sum to ≥ 40 (multi-country drops);
- brands include only present brands, ordered by count desc then name;
- passing different `FeedQuery`s does not change the result.

**`packages/db/test/queryCount.test.ts`** — build the test client with postgres.js's
`debug` hook to count statements:

```ts
const statements: string[] = [];
const sql = postgres(url, { debug: (_c, query) => statements.push(query) });
```

- `list()` on a full page issues **≤ 3** statements;
- `list()` returning 0 rows issues **1**;
- `getBySlug()` on a drop with related drops issues **≤ 6**;
- both budgets hold when `limit` is raised to 40 — the count must not scale with
  rows. This is the regression guard CLAUDE.md asks for: "a regression that quietly
  turns 1 query into 25 should fail CI".

**`packages/db/test/indexUsage.test.ts`**
- `SET enable_seqscan = off;` then `EXPLAIN` the default feed query; assert the plan
  text names `food_drop_feed_idx`. Same for `sort: 'trending'` →
  `food_drop_trending_idx`.
- The `enable_seqscan = off` is load-bearing: with only 40 seeded rows the planner
  will always prefer a sequential scan, so this asserts the index is *usable by the
  query* — which is the thing that actually regresses when someone changes an
  `ORDER BY` — rather than asserting a plan choice that only holds at scale. Say so
  in a comment, or the next reader will "fix" it.

**`packages/db/test/rowShape.test.ts`**
- every item from `list()` parses against `foodDropSummarySchema`;
- `getBySlug()` parses against `foodDropDetailSchema`;
- specifically assert `typeof firstSeenAt === 'string'` and that `releaseDate`
  matches `/^\d{4}-\d{2}-\d{2}$/` — the two S12 landmines, named explicitly so a
  failure points at the cause.

**Parity test — the one that proves the phase.**
`packages/db/test/parity.test.ts`: run the **same** `FeedQuery` through
`MockFoodDropRepository` and `PgFoodDropRepository` and assert the returned slug
arrays are identical, for at least: the default query, each single-facet filter, a
two-facet combination, a search term, and `sort: 'trending'`.

This is the highest-value test in the phase. It is the executable form of "the same
UI, now from Postgres", and it will catch ordering, filtering, and pagination
divergence that no amount of reading the SQL will.

Where mock and Postgres genuinely *cannot* agree — substring search (`pickl` mid-word)
versus FTS — document the divergence in Known limitations and assert the intended
SQL behaviour in `search.test.ts` instead of forcing parity. Do not weaken the SQL to
match the mock's `String.includes`, and do not delete the parity case silently.

### S16 — Build order

Each step ends somewhere you can stop.

1. **Infrastructure** — compose file, init SQL, `.env.example`, `npm run db:up`
   reaching healthy, `psql` connects and the three extensions are present.
2. **`packages/db` scaffold** — package.json, tsconfigs, path aliases, `client.ts`,
   `config.ts`. `npm run check` green with an empty schema.
3. **Schema + migration** — S4, `db:generate`, **read the emitted `.sql`**, confirm
   the S4.4 trio, `db:migrate` clean against a fresh volume.
4. **Normalisation helpers + their unit tests** — S6. `npm run test:unit` green. No
   database needed for this step.
5. **Seed** — S7. `db:seed`, then `db:studio` (or `psql`) and eyeball: 40 drops, all
   `published`, `source_count` matching `food_drop_source`.
6. **`list()`** — S9, plus `feedQuery.test.ts`. First real milestone.
7. **`getBySlug()` + `facets()`** — S10, S11, and their tests.
8. **The swap** — S13. Open the app. Compare against Phase 1 side by side.
9. **The test suite that protects it** — query counts, index usage, row shape,
   parity.
10. **Verification pass** — every command in the Verification block below, plus a
    `npm run db:reset && npm run dev` from cold.

Steps 6 and 8 are the two places to stop and look at the screen rather than the
terminal.

### S17 — Do not do these things

1. Do not change any file under `apps/web/` except `lib/repository.ts`,
   `next.config.ts`, and `package.json`.
2. Do not delete `MockFoodDropRepository` or the mock data. Core's unit tests use
   it, and the parity test needs it.
3. Do not import from `@bitedrop/core/mock` anywhere in `packages/db/src/` except
   the seed. The seed is the one legitimate consumer.
4. Do not import `@bitedrop/db` from `packages/core`. The direction is one-way.
5. Do not write SQL outside `packages/db/src/repositories/` (seed and migrations
   excepted — they are DDL and fixtures, not query paths).
6. Do not use `OFFSET`, `LIMIT n OFFSET m`, or page numbers. Keyset only
   (invariant 3).
7. Do not issue a query inside a loop, a `map`, or a `Promise.all` over rows. Batch
   with `= ANY($1)` (CLAUDE.md → Avoiding N+1 queries).
8. Do not interpolate user input into SQL or into a tsquery string. Parameterise,
   and sanitise the tsquery per S6.
9. Do not use `drizzle-kit push`. Generate, review, commit, migrate.
10. Do not add Redis, a queue, a search service, or a second container. `raw_item.stage`
    is the queue; Postgres FTS is the search (architecture §7 non-choices).
11. Do not mock the database in tests.
12. Do not add `any` or `@ts-ignore`, including at the driver boundary — that is
    where the temptation is.
13. Do not catch a database error to make a page render. Let it surface
    (CLAUDE.md → Errors; phase-01 S13 rule 10).
14. Do not compute `trending_score` at read time or add an `ORDER BY` over an
    expression (invariant 11). The column is seeded; Phase 9 computes it.
15. Do not add caching, ISR, or `unstable_cache` in this phase.
16. Do not create the Phase 11+ tables.
17. Do not restructure the repository layout from `03-local-dev.md`.

### S18 — Docs to update at completion

- **`docs/02-data-model.md`** — apply the four S4.3 changes, and add a line noting
  the Drizzle schema is now the authoritative version (the doc already anticipates
  this).
- **`docs/phases/README.md`** — status table row 2 → Complete, link this file.
- **`CLAUDE.md`** — the "Current status" line.
- **This file** — the Outcome half.

---

## Acceptance criteria

**Functional**

- [ ] 1 — `npm run db:reset && npm run dev` serves the feed from Postgres with no manual steps.
- [ ] 2 — The feed renders the same 40 drops in the same order as Phase 1, with every card field populated.
- [ ] 3 — Infinite scroll pages 12 / 12 / 12 / 4 to the end with no duplicated or skipped items, and `nextCursor` is `null` only on the last page.
- [ ] 4 — Filters compose OR within a facet and AND across facets; a multi-country drop appears exactly once.
- [ ] 5 — Search matches name, brand, and description; is case- and diacritic-insensitive; prefix-matches the last token; tolerates a one-character typo.
- [ ] 6 — Sort toggles newest ↔ trending against the indexed column.
- [ ] 7 — `/drops/[slug]` renders full detail, all sources, retailers, and related drops; unknown, unpublished, and tombstoned slugs all render 404.
- [ ] 8 — Sidebar facet counts match Phase 1 and do not change as filters are applied.

**Data layer**

- [ ] 9 — Every table in S4.1 exists; no Phase 11+ table exists.
- [ ] 10 — Every index in S4.4 exists, and the three feed indexes are partial.
- [ ] 11 — Migrations are committed `.sql`, apply cleanly to an empty database, and were generated (not pushed).
- [ ] 12 — The seed is one transaction, is re-runnable, and leaves `source_count` consistent with `food_drop_source` for all 40 drops.
- [ ] 13 — `list()` ≤ 3 queries, `getBySlug()` ≤ 6, independent of row count — asserted in tests.
- [ ] 14 — The default feed query and the trending query each use their named index under `enable_seqscan = off`.

**The swap**

- [ ] 15 — `apps/web` diff touches only `lib/repository.ts`, `next.config.ts`, `package.json`.
- [ ] 16 — `grep -rn "core/mock" apps/web` returns **zero** hits.
- [ ] 17 — The parity test passes for every query listed in S15, or each divergence is documented in Known limitations with a test asserting the intended behaviour.
- [ ] 18 — Every `list()` / `getBySlug()` result parses against its Zod schema; dates are strings, not `Date`s.

**Code**

- [ ] 19 — No SQL outside `packages/db/src/repositories/`, the seed, and migrations.
- [ ] 20 — `packages/core` does not import `@bitedrop/db`; `packages/db/src/` imports `@bitedrop/core/mock` only in the seed.
- [ ] 21 — No `@neondatabase/serverless`, `pg`, `@vercel/*`, or Prisma in any `package.json`.
- [ ] 22 — `npm run check` passes; `npm test` passes (unit + integration); no `any`, no `@ts-ignore`.

### Verification commands

```bash
# cold start, exactly as a new contributor would
npm run db:reset && npm run dev

npm run check
npm test
npm run test:unit          # must pass with Docker stopped

# criterion 16 — the swap is complete
grep -rn "core/mock" apps/web --include='*.ts' --include='*.tsx'      # expect 0

# criterion 15 — nothing else in the web app moved
git status --porcelain apps/web
# expect only: lib/repository.ts, next.config.ts, package.json

# criterion 19 — no SQL outside the repositories
grep -rnE "\b(SELECT|INSERT|UPDATE|DELETE)\b" \
  packages/core/src apps/web --include='*.ts' --include='*.tsx'       # expect 0
grep -rln "drizzle-orm\|postgres" apps/web --include='*.ts' --include='*.tsx'
# expect 0 — the web app never imports the driver or the ORM

# criterion 20 — dependency direction
grep -rn "@bitedrop/db" packages/core                                  # expect 0
grep -rn "core/mock" packages/db/src | grep -v "/seed/"                # expect 0

# criterion 21 — no forbidden drivers
grep -rn "neondatabase\|@vercel/\|\"prisma\"\|\"pg\"" \
  package.json apps/*/package.json packages/*/package.json             # expect 0

# criterion 10 — indexes exist and are partial
psql "$DATABASE_URL" -c "\di+ food_drop*"
psql "$DATABASE_URL" -c \
  "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='food_drop';"

# criterion 12 — denormalised count is honest
psql "$DATABASE_URL" -c "
  SELECT fd.slug, fd.source_count, count(fds.*) AS actual
  FROM food_drop fd LEFT JOIN food_drop_source fds ON fds.food_drop_id = fd.id
  GROUP BY fd.id HAVING fd.source_count <> count(fds.*);"            # expect 0 rows

# criterion 14 — the feed query can use its index
psql "$DATABASE_URL" -c "
  SET enable_seqscan = off;
  EXPLAIN SELECT id FROM food_drop
  WHERE published AND merged_into_id IS NULL
  ORDER BY first_seen_at DESC, id DESC LIMIT 13;"   # expect food_drop_feed_idx

# file size limit still holds
git ls-files 'packages/db/src/*.ts' 'packages/db/src/**/*.ts' \
  | xargs -I{} sh -c 'n=$(grep -cvE "^\s*(//|$)" "{}"); [ "$n" -gt 400 ] && echo "$n {}"' \
  ; echo "(no lines above = within limit)"
```

## Review notes

Worth a second opinion, specifically:

- **The `search_text` / FTS decision (S6) is the one place the product behaviour
  genuinely changes.** Phase 1 searched by substring; Postgres searches by token.
  `pick` still finds "Pickle" because of the `:*` rule, but `ickle` no longer will.
  Is that the right trade? The alternative — `ILIKE '%…%'` — matches Phase 1 exactly
  and cannot use an index, which is a real cost at scale and no cost at 40 rows.
  Decide this deliberately now rather than discovering it in Phase 5 with real data.
- **The parity test (S15) is the highest-leverage thing to scrutinise.** If it is
  weak, every other criterion here can pass while the feed quietly renders
  differently.
- **Is the seed's synthesised `raw_item` URL scheme going to confuse Phase 4?** Those
  rows look like real discoveries but point at URLs that do not exist. Worth deciding
  whether the seed should mark them somehow, or whether Phase 4's first act is simply
  to truncate and re-ingest.
- **Query budgets of 3 and 6** — are those the right ceilings, or is 6 for a detail
  page already one query too many? The related-drops feature is what costs 3 of them.
- Does anything in `02-data-model.md` *else* disagree with the domain types the way
  `short_description` did? The `short_description` gap was found by checking one
  field against one type; nobody has checked the other twenty.

---

## Outcome

*Filled in at completion. Everything below is written after the work, not before.*

### What changed

### How to run it

### How to test it

### Known limitations

### Decisions made during implementation

### Recommended next step
