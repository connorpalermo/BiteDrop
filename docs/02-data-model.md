# 02 — Data Model

Postgres 17. Extensions: `pg_trgm` (fuzzy matching), `unaccent` (normalisation),
`pgcrypto` (UUID generation). All three are available on Neon free.

DDL below is illustrative of intent — as of Phase 2, the authoritative version is the
Drizzle schema (`packages/db/src/schema/`) plus its generated, committed migrations
(`packages/db/migrations/`). Four differences from the DDL below, found by checking
this schema against the domain types in `packages/core/src/types.ts`, are called out
inline: `food_drop.short_description` and `.description` (`NOT NULL`), `source.name`
(`UNIQUE`), and `search_text`'s pre-normalisation. See
[`docs/phases/phase-02-database.md`](./phases/phase-02-database.md) S4.3/S18 for why.

---

## Raw layer — append-only

### `source`

The registry the brief asks for, plus the health fields it asks to track.

```sql
CREATE TABLE source (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text NOT NULL UNIQUE,          -- 'brandeating-rss'
  name                   text NOT NULL UNIQUE,          -- Phase 2: the seed resolves publications
                                                        -- by name; without UNIQUE a re-run could
                                                        -- create duplicate sources
  type                   source_type NOT NULL,          -- rss|json_api|html_listing|reddit|youtube
  url                    text NOT NULL,
  homepage_url           text,
  enabled                boolean NOT NULL DEFAULT true,
  fetch_interval_minutes integer NOT NULL DEFAULT 60,
  config                 jsonb NOT NULL DEFAULT '{}',   -- adapter-specific
  trust_tier             smallint NOT NULL DEFAULT 2,   -- 1 official, 2 reputable, 3 aggregator
  default_country        char(2),                       -- extraction hint
  -- health / reliability
  last_attempt_at        timestamptz,
  last_success_at        timestamptz,
  consecutive_failures   integer NOT NULL DEFAULT 0,
  last_error             text,
  http_etag              text,                          -- conditional GET
  http_last_modified     text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
```

`config` is intentionally JSONB: adapter options are genuinely heterogeneous
(CSS selectors for one type, subreddit names for another) and normalising them
would mean a table per adapter. This is the one place a blob is the right answer.

`trust_tier` is load-bearing, not decoration — it breaks dedupe ties in favour of
official announcements and gates auto-publishing.

### `fetch_run`

One row per source per attempt. This table *is* the observability requirement.

```sql
CREATE TABLE fetch_run (
  id            bigserial PRIMARY KEY,
  source_id     uuid NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        fetch_status NOT NULL,    -- success|partial|error|skipped_not_modified
  http_status   integer,
  items_seen    integer NOT NULL DEFAULT 0,
  items_new     integer NOT NULL DEFAULT 0,
  error_kind    text,                     -- timeout|http_error|parse_error|...
  error_message text,
  duration_ms   integer
);
CREATE INDEX fetch_run_source_time_idx ON fetch_run (source_id, started_at DESC);
```

Pruned to 30 days by a maintenance step — unbounded logging is the fastest way to
fill a 0.5 GB database.

### `raw_item`

The immutable discovery record and the pipeline's work queue.

```sql
CREATE TABLE raw_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  fetch_run_id    bigint REFERENCES fetch_run(id) ON DELETE SET NULL,
  url             text NOT NULL,              -- canonicalised: no utm_*, sorted query, no fragment
  url_hash        bytea NOT NULL,             -- sha256(url)
  content_hash    bytea,                      -- sha256(normalised body_text) — catches syndication
  title           text,
  author          text,
  published_at    timestamptz,
  discovered_at   timestamptz NOT NULL DEFAULT now(),
  excerpt         text,
  body_text       text,                       -- extracted text, capped at 40k chars
  image_url       text,
  raw_payload     jsonb,                      -- original feed entry, for reprocessing
  -- pipeline state
  stage           item_stage NOT NULL DEFAULT 'discovered',
  filter_reason   text,                       -- named rule that rejected it
  relevance_score real,
  processed_at    timestamptz,
  attempt_count   integer NOT NULL DEFAULT 0,
  last_error      text,

  CONSTRAINT raw_item_source_url_uniq UNIQUE (source_id, url_hash)
);

CREATE INDEX raw_item_url_hash_idx     ON raw_item (url_hash);              -- cross-source dedupe
CREATE INDEX raw_item_content_hash_idx ON raw_item (content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX raw_item_queue_idx        ON raw_item (stage, discovered_at)
  WHERE stage IN ('discovered', 'candidate');                               -- partial: the hot queue
```

Design notes:

- **`UNIQUE (source_id, url_hash)` is the idempotency guarantee.** Re-running a fetch
  `ON CONFLICT DO NOTHING`s, so overlapping or retried jobs cannot duplicate rows.
  Uniqueness is per-source rather than global because the same article legitimately
  arrives via an RSS feed *and* as a Reddit link post — two distinct observations.
- **`body_text` is capped and we never store raw HTML.** Full HTML would exhaust the
  free-tier database within weeks and buys nothing the extracted text does not.
- **`stage` as a queue** with a partial index means claiming work is one indexed query
  and no extra infrastructure exists to go wrong.

---

## Canonical layer

### `brand` and `brand_alias`

```sql
CREATE TABLE brand (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  normalized_name text NOT NULL,          -- lower, unaccented, punctuation stripped
  parent_brand_id uuid REFERENCES brand(id),   -- Oreo → Mondelez
  country_code    char(2),
  website_url     text,
  logo_url        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_normalized_trgm_idx ON brand USING gin (normalized_name gin_trgm_ops);

CREATE TABLE brand_alias (
  brand_id        uuid NOT NULL REFERENCES brand(id) ON DELETE CASCADE,
  normalized_alias text NOT NULL,
  PRIMARY KEY (brand_id, normalized_alias)
);
CREATE UNIQUE INDEX brand_alias_uniq ON brand_alias (normalized_alias);
```

`brand_alias` is not optional. "Reese's" / "Reeses" / "Reese" / "REESE'S" must resolve
to one brand or dedupe layer 3 silently fails and the product's core promise breaks.

### `category` and `country`

Small seeded reference tables, from the brief's lists.

```sql
CREATE TABLE category (
  id         smallserial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,     -- fast_food, restaurants, candy, snacks, chips,
  name       text NOT NULL,            -- drinks, desserts, grocery, convenience, seasonal, other
  emoji      text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE country (
  code   char(2) PRIMARY KEY,          -- ISO 3166-1 alpha-2
  name   text NOT NULL,
  emoji  text NOT NULL,
  region text NOT NULL                 -- north_america|europe|asia|...
);
```

`subcategory` stays **free text on `food_drop`**, not a table — the real taxonomy is
unknown until a few thousand drops exist. Promoting it to a table later is a cheap
migration; guessing the taxonomy now and being wrong is not.

"Europe" and "International" from the brief's filter list are not countries:
Europe is `country.region = 'europe'`, and International is a drop with more than
one country attached. Both are queries over this model, not extra enum values.

### `food_drop` — the canonical entity

```sql
CREATE TABLE food_drop (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  name               text NOT NULL,
  normalized_name    text NOT NULL,              -- dedupe key
  brand_id           uuid REFERENCES brand(id),
  category_id        smallint NOT NULL REFERENCES category(id),
  subcategory        text,
  short_description  text NOT NULL,               -- Phase 2: <=140 chars, what the card renders —
                                                   -- FoodDropSummary.shortDescription is a distinct
                                                   -- field from the full prose below, not a
                                                   -- truncation of it
  description        text NOT NULL DEFAULT '',    -- Phase 2: FoodDropDetail.description is `string`,
                                                   -- not `string | null`
  status             drop_status NOT NULL,        -- new|coming_soon|limited_time|
                                                 -- returning|discontinued|rumored
  is_limited_time    boolean NOT NULL DEFAULT false,
  release_date       date,
  availability_start date,
  availability_end   date,
  price_cents        integer,
  price_currency     char(3),
  image_url          text,
  image_stored_key   text,                        -- R2 key once images are mirrored
  confidence         real NOT NULL DEFAULT 0.5,   -- 0..1
  published          boolean NOT NULL DEFAULT false,
  merged_into_id     uuid REFERENCES food_drop(id),   -- tombstone after a merge
  -- denormalised for read performance
  source_count       integer NOT NULL DEFAULT 0,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),   -- "discovered X ago"
  last_source_at     timestamptz,
  trending_score     real NOT NULL DEFAULT 0,
  view_count         integer NOT NULL DEFAULT 0,
  search_text        text NOT NULL DEFAULT '',    -- composed on write, already lowercased and
                                                   -- diacritic-stripped by application code (Phase 2:
                                                   -- unaccent() is STABLE, not IMMUTABLE, so it can't
                                                   -- run inside this generated column's expression —
                                                   -- see docs/phases/phase-02-database.md S6)
  search_vector      tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

Three fields deserve explanation:

- **`published`** — an editorial gate that is not in the brief, and the single cheapest
  piece of insurance for its "quality over quantity" requirement. The pipeline may
  create a drop with low confidence without it appearing publicly; publishing is a
  separate decision (auto above a confidence threshold, manual below). Without this,
  every extraction bug is immediately user-visible.
- **`source_count`** — denormalised deliberately. The feed renders "3 sources" on every
  card; doing that as a correlated subquery is the N+1 the brief warns about.
  Maintained by the link step in the same transaction as the insert into
  `food_drop_source`.
- **`merged_into_id`** — dedupe *will* be wrong sometimes. Tombstoning instead of
  deleting keeps permalinks alive, preserves history, and makes merges reversible.

### `food_drop_source` — the multi-source join

This table is the product's differentiator expressed as a relation.

```sql
CREATE TABLE food_drop_source (
  food_drop_id    uuid NOT NULL REFERENCES food_drop(id) ON DELETE CASCADE,
  raw_item_id     uuid NOT NULL REFERENCES raw_item(id) ON DELETE CASCADE,
  source_id       uuid NOT NULL REFERENCES source(id),     -- denormalised for grouping
  role            source_role NOT NULL DEFAULT 'corroborating',  -- primary|corroborating
  link_method     link_method NOT NULL,   -- exact_url|content_hash|name_brand|fuzzy|llm|manual
  link_confidence real NOT NULL,
  linked_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (food_drop_id, raw_item_id)
);
CREATE INDEX food_drop_source_raw_idx ON food_drop_source (raw_item_id);
```

`link_method` makes every merge decision auditable — when a bad merge appears, the
reason is already recorded rather than needing reconstruction.

### Countries and retailers

```sql
CREATE TABLE food_drop_country (
  food_drop_id uuid    NOT NULL REFERENCES food_drop(id) ON DELETE CASCADE,
  country_code char(2) NOT NULL REFERENCES country(code),
  is_primary   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (food_drop_id, country_code)
);
CREATE INDEX food_drop_country_lookup_idx ON food_drop_country (country_code, food_drop_id);

CREATE TABLE retailer (
  id           smallserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,    -- target, walmart, cvs, seven_eleven, mcdonalds
  name         text NOT NULL,
  type         retailer_type NOT NULL,  -- grocery|convenience|pharmacy|mass|restaurant|online
  country_code char(2) REFERENCES country(code),
  logo_url     text
);

CREATE TABLE food_drop_retailer (
  food_drop_id         uuid NOT NULL REFERENCES food_drop(id) ON DELETE CASCADE,
  retailer_id          smallint NOT NULL REFERENCES retailer(id),
  country_code         char(2) REFERENCES country(code),
  confidence           real NOT NULL DEFAULT 0.5,
  evidence_raw_item_id uuid REFERENCES raw_item(id),   -- which source claimed it
  PRIMARY KEY (food_drop_id, retailer_id)
);
```

This satisfies "where can I buy it" as a schema capability without any retailer
integration: rows appear only when a source explicitly states availability, and
`evidence_raw_item_id` records which one did.

### `food_drop_merge` — audit trail

```sql
CREATE TABLE food_drop_merge (
  id                  bigserial PRIMARY KEY,
  winner_food_drop_id uuid NOT NULL REFERENCES food_drop(id),
  merged_food_drop_id uuid NOT NULL REFERENCES food_drop(id),
  method              link_method NOT NULL,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

---

## User + agent layer (Phase 11+, schema sketched now)

```sql
CREATE TABLE app_user (...);                -- Auth.js compatible

CREATE TABLE wishlist_item (
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  food_drop_id uuid NOT NULL REFERENCES food_drop(id) ON DELETE CASCADE,
  note         text,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, food_drop_id)
);

CREATE TABLE user_preference (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind    preference_kind NOT NULL,    -- category|brand|dietary|like|dislike
  value   text NOT NULL,
  weight  real NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, kind, value)
);

-- The resumable-workflow primitive for human-in-the-loop (Phase 15)
CREATE TABLE agent_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES agent_conversation(id) ON DELETE CASCADE,
  status          agent_run_status NOT NULL,  -- running|awaiting_approval|completed|failed
  state           jsonb NOT NULL,             -- message history + tool results
  pending_action  jsonb,                      -- the action awaiting approval
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_pick (                        -- BiteDrop Scout output (Phase 16)
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  food_drop_id uuid NOT NULL REFERENCES food_drop(id) ON DELETE CASCADE,
  pick_date    date NOT NULL,
  kind         text NOT NULL,                 -- weirdest|trending|hidden_gem
  headline     text NOT NULL,
  rationale    text NOT NULL,
  UNIQUE (pick_date, kind)
);
```

`agent_run` is what makes interrupt/resume a *real* resumable workflow rather than a
UI illusion, and it is one table rather than an orchestration framework.

---

## Read-path design

### Pagination — keyset, never OFFSET

`OFFSET` degrades linearly and double-renders items when new drops arrive mid-scroll,
which is exactly the wrong failure mode for an infinite feed. The cursor is
`(first_seen_at, id)`, base64-encoded:

```sql
SELECT ... FROM food_drop
WHERE published AND merged_into_id IS NULL
  AND (first_seen_at, id) < ($cursorTime, $cursorId)
ORDER BY first_seen_at DESC, id DESC
LIMIT 24;
```

Constant-time regardless of depth, and stable under concurrent inserts.

### Indexes

Every index below exists for a named query, per the brief's "use indexes intentionally".

```sql
-- main feed + trending
CREATE INDEX food_drop_feed_idx     ON food_drop (first_seen_at DESC, id DESC)
  WHERE published AND merged_into_id IS NULL;
CREATE INDEX food_drop_trending_idx ON food_drop (trending_score DESC, id DESC)
  WHERE published AND merged_into_id IS NULL;

-- filters (each composite ends in the sort key so filter+sort is one index scan)
CREATE INDEX food_drop_category_idx ON food_drop (category_id, first_seen_at DESC)
  WHERE published AND merged_into_id IS NULL;
CREATE INDEX food_drop_brand_idx    ON food_drop (brand_id, first_seen_at DESC)
  WHERE published AND merged_into_id IS NULL;
CREATE INDEX food_drop_status_idx   ON food_drop (status, first_seen_at DESC)
  WHERE published AND merged_into_id IS NULL;

-- search + fuzzy dedupe
CREATE INDEX food_drop_search_idx   ON food_drop USING gin (search_vector);
CREATE INDEX food_drop_name_trgm_idx ON food_drop USING gin (normalized_name gin_trgm_ops);
```

The partial `WHERE published AND merged_into_id IS NULL` predicate matters: unpublished
drops and tombstones will eventually outnumber published ones, and excluding them keeps
every feed index small.

### Search

Postgres FTS over an application-composed `search_text` (name + brand + subcategory +
description + retailer names), with `pg_trgm` as a typo-tolerant fallback.

`search_text` is composed in application code rather than by a generated column because
a generated column cannot reference another table, and brand name must be searchable —
"Taco Bell" has to match drops whose `name` never contains it. Composing it on write is
explicit, unit-testable, and keeps the weighting logic in one reviewable function.

This covers every example query in the brief (`Oreo`, `Taco Bell`, `pickle`, `Japan`,
`Halloween`, `limited edition`, `drinks`). It goes behind a `SearchRepository` interface
so that swapping in a dedicated engine later is one implementation, not a refactor.

**The typo-tolerant fallback uses `word_similarity(needle, normalized_name)`, not plain
`similarity()`.** Measured directly during Phase 2: `similarity('reeses caramel apple
cups', 'reeses')` — an *exact*, correctly-spelled word — scores 0.28, under the 0.3
threshold, because whole-string similarity is diluted by every word in `normalized_name`
the query never claimed to match. `word_similarity()` scores the query against its
best-matching word-boundary substring instead (1.0 for that same case), which is what
"typo-tolerant" actually requires once a product name is more than one word.

### Trending

Computed by the hourly job into `trending_score`, not at read time — so it is indexable
and the feed stays a single index scan.

```
score = w1·log(1 + source_count)          -- corroboration
      + w2·recency_decay(first_seen_at)    -- newness
      + w3·recency_decay(last_source_at)   -- still being talked about
      + w4·log(1 + view_count)             -- engagement
      + w5·trust_bonus(max source trust)   -- credibility
```

Deterministic, explainable, tunable by editing five constants — which is what the brief
asks for at this stage.

---

## Historical data

Nothing in this schema deletes a `food_drop`. Status moves to `discontinued`,
availability windows close, merges tombstone — but rows persist. `first_seen_at`,
`release_date`, and the `availability_*` pair give every brief-listed historical
query ("every Oreo flavour in 2026", "seasonal release trends", "brand launch
frequency") a direct SQL answer against indexed columns.

The only table with a retention policy is `fetch_run`, which is operational
telemetry rather than product data.
