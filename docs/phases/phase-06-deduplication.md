# Phase 06 — Deduplication

| | |
|---|---|
| **Status** | Complete — awaiting review |
| **Planned** | 2026-10-24 |
| **Completed** | 2026-10-24 |
| **Commits** | — (left in the working tree; commits are the repo owner's) |

**Goal.** Four sources reporting one product produce **one** `FoodDrop` with
four sources attached, not four drops — the product's actual differentiator,
finally implemented. Two more real sources (The Takeout, Foodbeast) come
online to give dedupe real overlapping coverage to work against.

**Non-goals.** LLM adjudication / Layer 5 (Phase 8) — a pair layers 1–4 can't
settle just stays as two separate drops, same as today · auto-creating new
`Brand` rows (still Phase 5/8's boundary; layers 3/4 both require an
already-resolved `brand_id`, so most real items still can't use them — see
Review notes) · reconciling or upgrading a drop's descriptive fields
(`name`, `description`, `status`, `releaseDate`, …) when a second source
corroborates it — only `source_count`, `last_source_at`, and `confidence`
change; the first extraction's fields win and are never overwritten ·
retroactively merging the real drops already sitting in a local dev database
from Phase 5 testing — `npm run db:reset && npm run ingest` naturally
produces deduped output going forward; no backfill tool · populating
`food_drop_merge` — nothing in this phase merges two *already-separate*
drops after the fact, only prevents new duplicates at ingest time ·
scheduling (Phase 7), enrichment/trending (Phase 9), the remaining sources
(Phase 10).

> **This document is a specification, not a sketch.** Every query, constant,
> and file path an implementer needs is stated here. If something is
> genuinely ambiguous, that is a defect in this document — **stop and ask
> rather than inventing an answer.**

> **Dedupe can only match what extraction already resolved.** Layers 3 and 4
> both require a matched `brand_id` — and Phase 5's real output showed only
> 1 of 7 real drops matched a brand (the Phase 2 mock's 8-brand list is
> small). In practice, **only Layers 1–2 (exact URL / identical syndicated
> content) will fire often** until brand coverage improves. That's expected,
> not a bug to chase in this phase — it's the same "sparse brand matching"
> limitation Phase 5 already flagged, now visibly affecting a second
> feature.

---

## Plan

### The one idea

One new DB-side lookup, consulted before the "create a new `food_drop`" step
Phase 5 always took unconditionally. Four ordered, indexed SQL queries — each
one *is* a layer from [`../01-architecture.md`](../01-architecture.md) §4 —
run in sequence; the first one that finds a live (non-tombstoned) match wins
and the candidate links to it instead of creating a duplicate. No match
after all four → create new, exactly Phase 5's existing path, unchanged.

**Why four SQL queries, not four "pure functions" as §4 describes.** The
architecture doc calls layers 1–4 "pure functions," but every layer's actual
matching logic — exact hash equality, `word_similarity()`, a date-range
filter — either already lives in an index Phase 2 built for exactly this
(`raw_item_url_hash_idx`, `raw_item_content_hash_idx`,
`food_drop_name_trgm_idx`, `food_drop_brand_idx`) or is a one-line SQL
predicate. Pulling every existing `food_drop` into Node to re-score fuzzy
matches in JS would throw away those indexes for no benefit — the same
reasoning Phase 2 already used for search's trigram fallback. The "pure,
reviewable, testable" part the architecture doc actually cares about is the
**decision table** (which layer → which `link_method` → which numeric
`link_confidence`) and the two tunable constants (similarity threshold, date
window) — those live in `packages/core` as named, imported values; the SQL
that applies them lives in `packages/db`.

### Turning on sources 3 and 4

[`../05-sources.md`](../05-sources.md)'s own phase plan calls for this:
*"Phase 6 (dedupe): add 3 and 4, which guarantees overlapping coverage of the
same products — the condition dedupe needs to be tested against."* Both
re-verified live today (2026-10-24):

| Source | Feed | Format | Notes |
|---|---|---|---|
| The Takeout | `https://thetakeout.com/rss` → redirects to `.../feed/` | Standard WordPress RSS 2.0 | No adapter change needed — same shape `rssAdapter` already parses |
| Foodbeast | `https://foodbeast.com/feed/` | Standard WordPress RSS 2.0 | Same |

Both returned real, varied content live — Foodbeast: *"Taco Bell Turns Up
The Heat With Its Latest Nacho Fries Remix"*, *"Lay's New Holiday Lineup
Include A Few Unexpected Flavors"* (genuine overlap potential with
PR Newswire's Taco Bell/Lay's coverage from Phase 5's real run). The Takeout's
sample skewed heavily listicle (*"12 Best New Costco Kirkland Signature Finds
Of 2026"*, *"The 12 Hands-Down Best New Chocolatey Candies Of 2026"*) —
confirming `05-sources.md`'s own "Medium" precision rating and exposing a
**real filter gap** (S7) the current `recipe_or_listicle` rule misses
whenever a number isn't immediately followed by "best"/"worst".

### Why `--stage=dedupe` folds into `--stage=extract`, not a new stage

`01-architecture.md`'s own stage table lists Dedupe's *input* as `candidate`
— the same input Extract takes — not "extracted structured fields." That
matches what actually happened in Phase 5: there is no persisted
intermediate state between a `candidate` row and a `linked`/`failed` one: no
new `raw_item` column holds extraction output, and nothing currently moves a
row to the `extracted` enum value. Adding one now, just to give Dedupe
something to read, would be a schema change this phase's actual job doesn't
need — the matching lookup runs on the same freshly-computed extraction
Extract already has in hand, in the same function, same transaction. So:
`runExtractStage` grows a matching step, and `cli.ts`'s `STAGE_OWNERS` entry
for `dedupe` changes from `'Phase 6'` to a clarifying message, the same
pattern Phase 5 used for `normalize`.

---

## Implementation spec

### S1 — `packages/core/src/dedupe.ts`: the shared decision table

Pure, no I/O (invariant 4) — constants and the link-method → confidence
mapping, not matching logic (S1's note above explains why there's no pure
matching *function* here):

```ts
export const DEDUPE_FUZZY_SIMILARITY_THRESHOLD = 0.3; // pg_trgm's own default — same as Phase 2's search fallback
export const DEDUPE_DATE_WINDOW_DAYS = 14; // Layer 4's discovery-proximity window

export const DEDUPE_LINK_CONFIDENCE = {
  exact_url: 1.0, // Layer 1 — certain
  content_hash: 1.0, // Layer 2 — certain
  name_brand: 0.9, // Layer 3 — high
  fuzzy: 0.7, // Layer 4 — medium
} as const;
```

Also move the publish decision out of `extractRepository.ts` and into a
shared pure function, since Phase 6 needs the identical check in a second
place (the link path) and duplicating a threshold constant across two files
is the kind of "same knowledge, same reason to change" DRY actually warns
about:

```ts
export const PUBLISH_CONFIDENCE_THRESHOLD = 0.6;

export function shouldPublish(status: DropStatus, confidence: number): boolean {
  return status !== 'rumored' && confidence >= PUBLISH_CONFIDENCE_THRESHOLD;
}
```

`extractRepository.ts`'s `buildFoodDropValues` (Phase 5) switches to calling
this instead of its private inline check.

### S2 — `packages/db/src/repositories/dedupeRepository.ts`

```ts
export interface DedupeMatch {
  foodDropId: string;
  linkMethod: 'exact_url' | 'content_hash' | 'name_brand' | 'fuzzy';
  linkConfidence: number;
}

export async function findDedupeMatch(
  db: Database,
  candidate: CandidateRawItem,
  extraction: FoodDropExtraction,
  brandId: string | null,
): Promise<DedupeMatch | null>;
```

Runs the four layers **in order, returning on the first hit**:

**Layer 1 — exact URL.** `raw_item.url_hash` is already canonicalised and
hashed by `apps/ingest`'s fetch stage (Phase 4), so an exact match here means
the same canonical article URL was observed by (at least) two sources.

```sql
SELECT COALESCE(fd.merged_into_id, fd.id) AS food_drop_id
FROM raw_item ri
JOIN food_drop_source fds ON fds.raw_item_id = ri.id
JOIN food_drop fd ON fd.id = fds.food_drop_id
WHERE ri.url_hash = $1 AND ri.id != $2
LIMIT 1
```

The `COALESCE(merged_into_id, id)` follows one tombstone hop so a match
against an already-merged drop resolves to the live winner — the only case
reachable today is a human manually tombstoning a drop, since nothing in
this phase creates merges itself, but it costs nothing to get right now.
Uses `raw_item_url_hash_idx`.

**Layer 2 — identical content hash (syndicated copy, different URL).** Same
shape as Layer 1, filtering on `content_hash` instead; skipped entirely when
`candidate.contentHash` is `null`. Uses `raw_item_content_hash_idx`.

**Layer 3 — same brand, exact normalised name.** Skipped entirely when
`brandId` is `null` (most real items, per the warning banner above).

```sql
SELECT id AS food_drop_id FROM food_drop
WHERE brand_id = $1 AND normalized_name = $2 AND merged_into_id IS NULL
LIMIT 1
```

**Layer 4 — same brand, fuzzy name, discovered within the window.** Also
skipped when `brandId` is `null`. Reuses `word_similarity()` over plain
`similarity()` for the identical reason Phase 2's search fallback does — see
`feedQuery.ts`'s `searchFilter` comment.

```sql
SELECT id AS food_drop_id FROM food_drop
WHERE brand_id = $1
  AND merged_into_id IS NULL
  AND word_similarity($2, normalized_name) > $3
  AND first_seen_at BETWEEN $4::timestamptz - ($5 || ' days')::interval
                         AND $4::timestamptz + ($5 || ' days')::interval
ORDER BY word_similarity($2, normalized_name) DESC
LIMIT 1
```

`$2` is `normalizeName(extraction.name)` (reusing Phase 2's helper — never
re-implement name normalisation a second time); `$3` is
`DEDUPE_FUZZY_SIMILARITY_THRESHOLD`; `$4` is the candidate's `discoveredAt`;
`$5` is `DEDUPE_DATE_WINDOW_DAYS`. The window is symmetric (before *and*
after) because a slower-crawled source can legitimately discover the same
real-world event a few days after a faster one did.

### S3 — Linking a match

```ts
export async function linkRawItemToFoodDrop(
  db: Database,
  candidate: CandidateRawItem,
  match: DedupeMatch,
  newExtraction: FoodDropExtraction,
): Promise<void>;
```

One transaction:

1. `INSERT food_drop_source` — `role: 'corroborating'` (never `'primary'` —
   that was already claimed by whichever raw_item created the drop),
   `link_method: match.linkMethod`, `link_confidence: match.linkConfidence`.
2. `UPDATE food_drop SET`:
   - `source_count = source_count + 1`
   - `last_source_at = GREATEST(last_source_at, candidate.discoveredAt)`
   - `confidence = GREATEST(confidence, newExtraction.confidence)` —
     corroboration never *lowers* confidence, and a stronger second
     extraction is allowed to raise it
   - `published = shouldPublish(status, <new confidence>)` — using the
     drop's **existing** `status` (never overwritten — see Non-goals) against
     the just-recomputed confidence. This is the mechanism that lets a
     drop Phase 5's math left unpublished get published once a second
     source corroborates it.
3. `UPDATE raw_item SET stage = 'linked'` for the candidate — same end state
   as creating a new drop.

### S4 — Wiring into `runExtractStage.ts`

`extractOne` (Phase 5) currently calls `createFoodDropFromExtraction`
unconditionally after a successful extraction. It now checks dedupe first:

```
result = ruleBasedProvider.extract(...)
if not result.ok: markRawItemFailed; return failed

resolve brandId (unchanged from Phase 5)
resolve categoryId (unchanged from Phase 5)

match = findDedupeMatch(db, candidate, result.value, brandId)
if match:
  linkRawItemToFoodDrop(db, candidate, match, result.value)
  return { outcome: 'linked_existing' }
else:
  createFoodDropFromExtraction(db, candidate, result.value, { brandId, categoryId })
  return { outcome: 'created' }
```

`--dry-run` logs which path *would* run (and, for a match, which layer and
which existing drop) without writing either way — same contract as every
other dry-run in this pipeline.

**This also naturally dedupes within a single run**, with no special-casing:
`listCandidateRawItems` returns every surviving candidate, `extractOne` runs
sequentially (unchanged from Phase 5), and each one's dedupe lookup is a
normal read against whatever the *previous* iterations already committed —
so if The Takeout and Foodbeast both report the same product in one run, the
second one to be processed sees the first one's freshly-created drop as a
real match target.

### S5 — `cli.ts`: `--stage=dedupe`'s new message

```ts
const STAGE_OWNERS: Record<string, string> = {
  normalize: 'folded into --stage=extract, not a separate stage',
  dedupe: 'folded into --stage=extract — matching runs before a new food_drop would be created, not as a separate pass (see docs/phases/phase-06-deduplication.md)',
  enrich: 'Phase 9',
  publish: '...', // unchanged from Phase 5
};
```

### S6 — `packages/db/src/seed/sources.ts`: two more real sources

Add to `REAL_FEED_OVERRIDES` (Phase 4 S9's pattern), for `'The Takeout'` and
`'Foodbeast'`:

| `name` | `slug` | `url` | `trustTier` |
|---|---|---|---|
| `'The Takeout'` | `thetakeout-rss` | `https://thetakeout.com/rss` | `2` |
| `'Foodbeast'` | `foodbeast-rss` | `https://foodbeast.com/feed/` | `2` |

Both get `homepageUrl` set to their base URL, same as Phase 4's two. This
flips their seeded `enabled` to `true` (the override map is what Phase 4's
`enabled: override !== undefined` check keys off of) — no other code change
needed for them to start fetching.

### S7 — Filter fix: The Takeout's listicle pattern

Real sampled titles the current `recipe_or_listicle` rule misses: *"12 Best
New Costco Kirkland Signature Finds Of 2026"* (number not immediately
followed by "best"), *"The 12 Hands-Down Best New Chocolatey Candies Of
2026"* (words between the number and "best"). Broaden
`RECIPE_OR_LISTICLE_PATTERN` in `packages/core/src/filter.ts` to also catch a
title that simply **starts** with a number — the strongest, lowest-risk
listicle signal there is; real product announcements essentially never open
with a bare digit:

```ts
const RECIPE_OR_LISTICLE_PATTERN =
  /\brecipe\b|how to make|\btop \d+\b|ranked:|\d+ (best|worst)|^\d+\s|^the \d+\s/i;
```

### S8 — Required tests

**`packages/core/test/dedupe.test.ts`** — the constants are public and
imported by two call sites; assert their values directly (regression guard
against an accidental edit) and that `shouldPublish` matches Phase 5's
existing threshold behaviour exactly (status/confidence table carried over
from `extractRepository.test.ts`'s existing cases).

**`packages/db/test/dedupeRepository.test.ts`** — integration, real
Postgres, the actual regression corpus this phase exists to build:
- Layer 1: two raw_items (different sources), same canonical URL → second
  one's lookup finds the first's `food_drop_id` via `exact_url`.
- Layer 2: two raw_items, different URLs, identical `content_hash` → found
  via `content_hash`.
- Layer 3: two raw_items, same `brand_id`, identical `normalized_name` →
  found via `name_brand`.
- Layer 4: same `brand_id`, similar-but-not-identical name, within the
  14-day window → found via `fuzzy`. The same pair **outside** the window →
  not found (returns `null`) — the negative case that proves the window is
  load-bearing, not decorative.
- No `brand_id` → Layers 3/4 never run, even if an identical-name drop
  exists with a *different* (or null) brand.
- A match against a tombstoned drop resolves to `merged_into_id`'s target
  via the `COALESCE`.
- `linkRawItemToFoodDrop`: `source_count` increments, `last_source_at`
  advances, `confidence` only ever increases, a previously-unpublished drop
  (confidence `0.5`) becomes `published: true` after a match raises
  confidence to `0.65`, and the drop's original `name`/`description` are
  byte-for-byte unchanged after the link.

**`apps/ingest/test/runExtractStage.test.ts`** (extend) — two candidates in
one run, engineered to match each other via Layer 3 (same fake brand +
identical extracted name): the second one links to the first's drop instead
of creating a second one; `food_drop` count increases by exactly 1, not 2.

### S9 — Docs to update at completion

`docs/05-sources.md`'s "Phase plan" section — mark sources 3/4 as fetched,
and add their live-reverification findings (the listicle pattern) the same
way Phase 4's findings were added for sources 1/2.

---

## Acceptance criteria

**Dedupe**

- [x] 1 — Two raw_items (different sources) with an identical canonical URL
      produce one `food_drop` with two `food_drop_source` rows, not two drops.
- [x] 2 — Two raw_items with identical `content_hash` but different URLs
      produce one `food_drop`.
- [x] 3 — Two raw_items, same resolved brand, identical normalised name,
      produce one `food_drop` via `name_brand`.
- [x] 4 — Two raw_items, same brand, similar name, discovered within 14 days
      produce one `food_drop` via `fuzzy`; the identical pair discovered 20
      days apart produces **two**.
- [x] 5 — A match raises `source_count`, advances `last_source_at`, and only
      ever raises (never lowers) `confidence`.
- [x] 6 — A previously-unpublished drop becomes `published: true` once a
      match raises its confidence over `0.6`.
- [x] 7 — A matched drop's `name`/`description`/`status`/other descriptive
      fields are never modified by a link.
- [x] 8 — No `brand_id` on the candidate → Layers 3/4 are skipped entirely.

**Sources**

- [x] 9 — The Takeout and Foodbeast are enabled, fetch successfully, and
      items flow through filter/extract/dedupe the same as sources 1/2.
- [x] 10 — The Takeout's bare-number-leading listicle titles are rejected
      as `recipe_or_listicle`.

**Architecture**

- [x] 11 — All SQL for this phase lives under `packages/db/src/repositories/`.
- [x] 12 — `packages/core` gains no I/O.
- [x] 13 — `--stage=dedupe` gives the clarifying message from S5; it is not a
      separately runnable stage.
- [x] 14 — `extractRepository.ts`'s publish check and `dedupeRepository.ts`'s
      publish check both call the one shared `shouldPublish`.

**Hygiene**

- [x] 15 — `npm run check && npm test` pass, including the new regression
      corpus.

### Verification commands

```bash
npm run check && npm test

npm run db:reset
npm run ingest   # now 4 sources; watch for a real cross-source match in the wild
npx tsx -e "
(async () => {
  const { config } = await import('dotenv'); config({ path: '.env.local' });
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  console.log(await sql\`SELECT name, source_count, confidence, published FROM food_drop WHERE source_count > 1\`);
  await sql.end();
})();
"
```

## Review notes

Worth a second opinion, specifically:

- **`DEDUPE_DATE_WINDOW_DAYS = 14` is a guess with no real data to validate
  it against yet** — long enough to absorb crawl-cadence lag between sources
  run manually/ad hoc today, short enough to not merge this year's seasonal
  item with last year's `returning` one. Worth revisiting once Phase 7 makes
  ingestion actually hourly and the real lag between sources is observable.
- **Layers 3/4 being brand-gated means dedupe will visibly under-perform
  until brand coverage improves** (same root cause as Phase 5's sparse brand
  matching). This phase does not add brand auto-creation to compensate —
  confirming that's still the right call, now that it's blocking a second
  feature, not just the brand facet looking sparse.
- **The `COALESCE(merged_into_id, id)` tombstone-follow is a single hop**,
  not a full chain walk — unreachable in practice this phase (nothing creates
  merges), included only because it was free to get right. Revisit if a
  future phase ever chains merges.
- **No reconciliation of descriptive fields on a match (Non-goals)** means a
  drop's `name`/`description` stay whatever the *first* source's extraction
  produced, even if a later, better source's extraction would have been
  clearly superior. Reasonable for now (simplicity, no risk of a corroborating
  source silently overwriting a correct value with a wrong one) but worth
  flagging as the kind of thing Phase 8's LLM adjudication might eventually
  want to improve on.

---

## Outcome

### What changed

- **`packages/core/src/dedupe.ts`** (new) — `DEDUPE_FUZZY_SIMILARITY_THRESHOLD`,
  `DEDUPE_DATE_WINDOW_DAYS`, `DEDUPE_LINK_CONFIDENCE`, `PUBLISH_CONFIDENCE_THRESHOLD`,
  `shouldPublish`.
- **`packages/db/src/repositories/extractRepository.ts`** — `buildFoodDropValues`
  now calls the shared `shouldPublish` instead of its own private threshold check.
  `CandidateRawItem` gained a `contentHash` field (needed by Layer 2 — a plan gap,
  see Decisions).
- **`packages/db/src/repositories/dedupeRepository.ts`** (new) — `findDedupeMatch`
  (the four ordered layers) and `linkRawItemToFoodDrop`.
- **`apps/ingest/src/runExtractStage.ts`** — `extractOne` now checks
  `findDedupeMatch` before creating; dry-run logs which food_drop/layer it would
  link to. `ExtractStageResult` gained a `linked` count alongside `created`.
- **`apps/ingest/src/cli.ts`** — `extract` log line reports `linked`;
  `--stage=dedupe`'s rejection message now explains the fold-into-extract
  decision instead of promising a future phase.
- **`packages/core/src/filter.ts`** — `RECIPE_OR_LISTICLE_PATTERN` broadened
  with `^\d+\s`/`^the \d+\s` for The Takeout's bare-number listicle titles.
- **`packages/db/src/seed/sources.ts`** — The Takeout and Foodbeast added to
  `REAL_FEED_OVERRIDES`, both `enabled: true`.
- **Tests** — `packages/core/test/dedupe.test.ts` (new),
  `packages/db/test/dedupeRepository.test.ts` (new, the regression corpus:
  all 4 layers, the Layer 4 negative date-window case, the brand-gate case,
  and `linkRawItemToFoodDrop`'s field-preservation/confidence-monotonicity
  behavior), `apps/ingest/test/runExtractStage.test.ts` (extended with a
  same-run dedupe case), `packages/core/test/filter.test.ts` (extended with
  the real Takeout listicle titles). 256 tests pass across 5 projects.

### How to run it

```bash
npm run db:reset
npm run ingest   # now fetches all 4 sources, then filters, extracts, and dedupes
```

### How to test it

```bash
npm run check && npm test   # 256 tests, all green
npm run build
```

By hand, against the real local Postgres and all four real live feeds: ran the
full pipeline end to end and inspected every drop with more than one *real*
source attached (query in Acceptance criteria's Verification commands,
filtered to `created_at` from this run — the mock seed's own multi-source
drops otherwise swamp the same query, since the mock seed reuses the same
`source` rows).

### Known limitations

- **A real cross-source match was found live, unprompted, on the very first
  run** — The Takeout's *"Wingstop's Sour Patch Kids Wicked Punch Wings Are
  Outrageous And Delicious"* and Foodbeast's independently-written *"Wingstop
  Just Made Sour Patch Kids-Flavored Chicken Wings"* linked via **Layer 4
  (fuzzy, confidence 0.7)** — both headlines happened to mention "Sour Patch
  Kids," which is one of Phase 2's 8 mock brands, so both extractions resolved
  the same `brand_id` and the fuzzy name comparison did the rest. This is
  exactly the feature working as designed, and it's also a direct
  illustration of the brand-gating limitation flagged in the warning banner:
  it only worked *because* both headlines happened to name a brand already in
  the small mock list. A genuinely novel brand pair (neither headline naming
  anything in the 8-brand list) still can't use Layers 3/4 at all.
- **Layers 1/2 did not fire in this run** — no exact URL or identical
  syndicated content was observed across the 4 sources live. Expected (these
  require either literal URL reuse or verbatim content syndication, both
  comparatively rare across independently-written coverage) and still fully
  covered by the regression corpus's synthetic cases.
- Everything else from the Plan's Review notes stands as written and was not
  revisited: the 14-day window, the single-hop tombstone-follow, and the
  no-field-reconciliation decision are all unchanged from the plan.

### Decisions made during implementation

- **`CandidateRawItem` needed a `contentHash` field that the Phase 5-written
  type didn't have** — found immediately by `tsc`, not discovered at runtime.
  Phase 5 never needed `raw_item.content_hash` past the fetch stage, so it was
  never threaded through `listCandidateRawItems`. Added it there, since Layer
  2 is specifically about comparing content hashes across candidates.
- **A real bug in `linkRawItemToFoodDrop`'s `GREATEST(...)` SQL, caught by the
  test suite before it ever reached a real database run**: interpolating a
  raw JS `Date` object into a Drizzle `sql` template doesn't serialize the
  way a typed column setter does — postgres.js's bind layer threw
  `TypeError: The "string" argument must be of type string or an instance of
  Buffer`. Fixed by interpolating the already-ISO-string `discoveredAt`
  with an explicit `::timestamptz` cast instead of wrapping it in `new
  Date(...)` first. Both `packages/db/test/dedupeRepository.test.ts` and
  `apps/ingest/test/runExtractStage.test.ts`'s new dedupe case caught this
  independently, which is exactly the "a regression that quietly turns 1
  query into a crash should fail CI" property the test suite exists for.
- **The verification query needed a `created_at` recency filter that the
  Plan's own verification command didn't account for**: the mock seed's
  `food_drop_source` rows point at the *same* `source` rows real ingestion
  uses (Phase 4 patched the existing 8 seeded rows rather than creating new
  ones), so a naive `WHERE source_count > 1` surfaces 30+ mock-seeded
  multi-source drops before any real one. Not a code change — just a sharper
  manual-verification query, noted here so the next phase's spot-checks don't
  rediscover it.

### Recommended next step

**Phase 7 — Scheduling + observability.** The pipeline now does everything
the roadmap describes for the core ingestion loop (fetch → filter → extract →
dedupe) across 4 real sources, manually. The next meaningful gap is that
nothing runs it — Phase 7 is what turns `npm run ingest` into an hourly
GitHub Actions job and adds the `/admin/health` page `fetch_run` + `source`
health columns already support. Before starting, it's worth deciding whether
to run the pipeline once against Neon (production) now that dedupe exists,
or wait until Phase 7's scheduling lands — running it manually first would
finally put real `FoodDrop`s on the live site.
