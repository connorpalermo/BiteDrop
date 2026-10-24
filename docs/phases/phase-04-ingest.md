# Phase 04 — Ingest CLI + first adapters

| | |
|---|---|
| **Status** | Complete — awaiting review |
| **Planned** | 2026-10-24 |
| **Completed** | 2026-10-24 |
| **Commits** | — (left in the working tree; commits are the repo owner's) |

**Goal.** `npm run ingest` populates `raw_item` from 2 real, live RSS/Atom feeds —
Brand Eating and PR Newswire — with full observability (`fetch_run`), per-source
failure isolation, and idempotent re-runs.

**Non-goals.** Filtering junk out (Phase 5) · extracting structured fields or
creating any `FoodDrop` (Phase 5) · deduplication (Phase 6) · scheduling this on a
cron (Phase 7) · the 4 other already-probed sources from
[`../05-sources.md`](../05-sources.md) (Phase 6/10) · an HTML-listing or Reddit
adapter (Phase 10) · the admin health page that reads `fetch_run` (Phase 7) ·
anything in `apps/web`.

> **This document is a specification, not a sketch.** Every file path, literal
> value, and algorithm an implementer needs is stated here rather than left to
> judgment. If something is genuinely ambiguous, that is a defect in this
> document — **stop and ask rather than inventing an answer.**

> **This phase is deliberately unfiltered.** `raw_item.stage` stays `'discovered'`
> for everything inserted. PR Newswire's food-and-beverage feed is, per live
> sampling (see S9), roughly 95% not food news — lawsuit notices, pharma trials,
> sponsored local-business content. **That is expected, not a bug.** Seeing mostly
> noise in `raw_item` after a run is the correct outcome of this phase; Phase 5 is
> where it gets filtered.

---

## Plan

### The one idea

Two sources, one adapter type, one pipeline stage (Fetch — `docs/01-architecture.md`
§3 table, row 1). Everything else in the pipeline (`filter`, `extract`, `normalize`,
`dedupe`, `enrich`, `publish`) is a later phase's `item_stage`; this phase only ever
writes `stage = 'discovered'`.

`SourceAdapter` is a **designed seam** (CLAUDE.md's named exception list: this
boundary is swappable from day one), so its interface goes in `packages/core` now,
with a single `rss` implementation in the new `packages/sources` package — even
though there is only one adapter *type* today, because the six-feed survey in
`05-sources.md` already proves a second type (`html_listing`, Phase 10) is coming.

The **write-side repository that records `fetch_run` and inserts `raw_item`** is
the opposite case: it has exactly one implementation (Postgres) and no concrete
plan for a second one. Per CLAUDE.md → Interface contracts ("define the interface
when the second implementation appears, not the first"), this phase does **not**
add an `IngestRepository` interface to `packages/core`. `apps/ingest` depends on
`@bitedrop/db` directly, the same way `packages/db/src/seed/*.ts` already does.
All SQL still lives under `packages/db/src/repositories/` (invariant 1) — the
difference from `PgFoodDropRepository` is there is no abstract interface sitting
in front of it.

### Scope: exactly which two sources, and what changes about them

[`../05-sources.md`](../05-sources.md) already settled this: **Brand Eating**
(trust tier 2) and **PR Newswire — Food & Beverage** (trust tier 1). Both were
re-verified live on 2026-10-24 (see S9) — the feeds still return 200, but one
finding changes the implementation:

**Brand Eating's feed is Atom, not RSS, despite the `alt=rss` query param.**
`https://www.brandeating.com/feeds/posts/default?alt=rss` 302-redirects to a
FeedBurner URL whose content is Atom 1.0 (`<feed>` / `<entry>`), not RSS 2.0
(`<rss>` / `<item>`). Node's native `fetch()` follows the redirect automatically,
so no redirect-handling code is needed — but the adapter must parse **both**
feed formats, not assume RSS. See S4.

The existing seed (`packages/db/src/seed/sources.ts`, Phase 2) already inserts a
`source` row named `'Brand Eating'` and one named `'PR Newswire'` — but with a
**placeholder URL** (the mock's publication base URL, not a real feed endpoint)
and a flat `trustTier: 2` for every publication. This phase corrects both, for
**only these two rows** (S7) — the other 6 seeded publications are untouched,
because they are out of scope until Phase 6/10.

---

## Implementation spec

### S1 — `packages/sources`: new package

```json
// packages/sources/package.json
{
  "name": "@bitedrop/sources",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "fast-xml-parser": "^5.11.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

```json
// packages/sources/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src", "test"]
}
```

Confirmed this session: `fast-xml-parser` (5.11.2) and `cheerio` are not installed
anywhere yet. Only `fast-xml-parser` is added now — `cheerio` is for the
`html_listing` adapter, Phase 10. Do **not** add `undici`; Node 22's global
`fetch()` is already undici underneath (architecture doc §7's "undici" choice is
already satisfied with zero dependencies).

Wire the package in exactly like `packages/db` was wired in Phase 2 S1:

1. **`tsconfig.base.json`** `paths` — add `"@bitedrop/sources": ["packages/sources/src/index.ts"]`.
2. **`tsconfig.json`** (root) — add the same path entry, plus
   `"packages/sources/src/**/*.ts"` and `"packages/sources/test/**/*.ts"` to
   `include`.
3. **`apps/ingest/package.json`** (S8) depends on `"@bitedrop/sources": "*"`.

### S2 — `packages/core`: the ingest-side domain types

New file `packages/core/src/source.ts`, exported from `src/index.ts`. Pure types
only — no I/O, per invariant 4.

```ts
export type IngestSourceType = 'rss' | 'json_api' | 'html_listing' | 'reddit' | 'youtube';

export interface IngestSource {
  id: string;
  slug: string;
  name: string;
  type: IngestSourceType;
  url: string;
  config: Record<string, unknown>;
  httpEtag: string | null;
  httpLastModified: string | null;
}

/** One pre-normalisation discovery, before url_hash/content_hash are computed. */
export interface DiscoveredItem {
  url: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null; // ISO 8601, or null if the feed omits it
  excerpt: string | null;
  bodyText: string | null; // capped at 40k chars by the adapter — invariant 5
  imageUrl: string | null;
  rawPayload: unknown; // the original feed entry, JSON-safe, for reprocessing
}

export interface FetchContext {
  timeoutMs: number;
  userAgent: string;
}

export interface FetchResult {
  items: DiscoveredItem[];
  etag: string | null;
  lastModified: string | null;
  notModified: boolean; // true on a 304 — items is [] and the caller skips the rest
}

export interface SourceAdapter {
  readonly type: IngestSourceType;
  fetch(source: IngestSource, ctx: FetchContext): Promise<FetchResult>;
}
```

`IngestSourceType`'s members must stay in sync with `sourceTypeEnum` in
`packages/db/src/schema/enums.ts` — same risk `drop_status` carries (Phase 2 S4.2),
same mitigation: asserted in a test (S9).

Add one pure function to the existing `packages/core/src/normalize.ts`:

```ts
/**
 * Canonicalises a URL for hashing: strips the fragment, drops every query
 * param starting with `utm_`, and sorts the remaining params by key — so the
 * same article reached via two different tracking links still hashes the
 * same (02-data-model.md's raw_item.url comment).
 */
export function canonicalizeUrl(rawUrl: string): string;
```

### S3 — `canonicalizeUrl`: exact algorithm

1. `new URL(rawUrl)`. (Letting this throw on a malformed URL is correct — the
   caller treats it as a per-item failure, not swallowed.)
2. Clear the fragment (`url.hash = ''`).
3. Collect `url.searchParams` entries, drop any whose key lowercased starts with
   `utm_`.
4. Sort the remaining entries by key, ascending, `localeCompare`.
5. Rebuild `url.search` from the sorted, filtered entries.
6. Return `url.toString()`.

This is the function `02-data-model.md`'s `raw_item.url` comment names
("canonicalised: no utm_\*, sorted query, no fragment") and that nothing has
implemented yet — confirmed by grep this session.

### S4 — The RSS/Atom adapter: `packages/sources/src/adapters/rss.ts`

One adapter handles both of this phase's feeds; it detects format from the
parsed document's root key rather than trusting `config` or the URL.

```ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export const rssAdapter: SourceAdapter = {
  type: 'rss',
  async fetch(source, ctx) { /* see algorithm below */ },
};
```

**Algorithm:**

1. Build headers: `User-Agent: ${ctx.userAgent}`, plus `If-None-Match` from
   `source.httpEtag` and `If-Modified-Since` from `source.httpLastModified` when
   present (conditional GET — S5).
2. `fetchWithRetry(source.url, { headers, timeoutMs: ctx.timeoutMs })` (S5).
3. **304** → return `{ items: [], etag: source.httpEtag, lastModified: source.httpLastModified, notModified: true }` immediately. Do not parse a body.
4. Non-2xx, non-304 → throw (the caller in `apps/ingest` catches this per source — S7).
5. Parse the body text with `fast-xml-parser`.
6. **Format detection:** if `doc.rss?.channel` exists, it is RSS 2.0; else if
   `doc.feed` exists, it is Atom 1.0; else throw `UnrecognizedFeedFormatError`.
7. Map every `item` (RSS) or `entry` (Atom) to a `DiscoveredItem` per the table
   below.
8. Return `{ items, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), notModified: false }`.

**Field mapping:**

| `DiscoveredItem` field | RSS 2.0 (`<item>`) | Atom 1.0 (`<entry>`) |
|---|---|---|
| `url` | `link` (text node) | **see landmine below** |
| `title` | `title` | `title` (`#text` if it has a `type` attribute, else the plain string) |
| `author` | `author` or `dc:creator` | `author.name` |
| `publishedAt` | `pubDate`, parsed with `new Date(...)`, `null` if unparseable | `published` ?? `updated` |
| `excerpt` | `description`, truncated to 500 chars | `summary`, truncated to 500 chars |
| `bodyText` | `content:encoded` if present, else `description`; **capped at 40,000 chars** (invariant 5) | `content` if present, else `summary`; same cap |
| `imageUrl` | `enclosure[@_url]` if `@_type` starts with `image/`, else `null` | `null` (Atom entries in this feed carry no image) |
| `rawPayload` | the parsed `item` object, as-is | the parsed `entry` object, as-is |

> **Landmine — Atom entries have multiple `<link>` elements; the article URL is
> specifically the `rel="alternate"` one.** A real Brand Eating entry (verified
> live, 2026-10-24) carries `rel="replies"` (×2 — a comments feed), `rel="edit"`,
> `rel="self"`, and `rel="alternate" type="text/html"`. Naively taking the first
> `<link>` captures the **comments feed URL**, which corrupts `raw_item.url`,
> silently defeats `UNIQUE (source_id, url_hash)`, and breaks Phase 6's dedupe
> before it exists. **Selection rule:** normalise `entry.link` to an array (it is
> a single object, not an array, when there is exactly one `<link>`), then pick
> the first link whose `@_rel` is `'alternate'` **or absent** (Atom's default
> `rel` is `alternate` per RFC 4287 §4.2.7.2) — never just `links[0]`.

Timeout, retries, and robots.txt are shared concerns, factored out rather than
duplicated inside this adapter (S5–S6), since Phase 10 will add a second adapter
that needs the same three things.

### S5 — `packages/sources/src/httpClient.ts`: timeout and retry

```ts
export async function fetchWithRetry(
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
): Promise<Response>;
```

- 10 s timeout via `AbortSignal.timeout(init.timeoutMs)` — `05-sources.md`'s
  operating rules.
- Max 2 retries, exponential backoff (500 ms, then 1500 ms) — **only** on a
  network error (`fetch` throwing) or an HTTP 5xx response. A 4xx is not
  retried; a 4xx is a configuration problem, not a transient one.
- A 304 is a success, not an error — returned as-is, no retry.
- After exhausting retries, the final error propagates to the caller (`rss.ts`
  step 4, which rethrows to `apps/ingest`'s per-source try/catch — S7).

### S6 — `packages/sources/src/robots.ts`: honouring `robots.txt`

```ts
export async function isFetchAllowed(
  feedUrl: string,
  userAgent: string,
  timeoutMs: number,
): Promise<boolean>;
```

- Fetch `${new URL(feedUrl).origin}/robots.txt`, single attempt, no retry
  (robots.txt being briefly unreachable should not block the real fetch).
- **On any non-200 response, or a thrown network/timeout error, return `true`**
  (allowed). A missing or broken `robots.txt` is not a disallow.
- On 200: parse into groups by `User-agent:` line (one group per line, lines
  until the next `User-agent:` or EOF belong to it). Pick the group whose
  `User-agent` exactly matches `userAgent`'s bot-name token (`'BiteDropBot'`,
  case-insensitive) if one exists; otherwise the `*` group; otherwise, no
  applicable group → return `true`.
- Collect that group's `Disallow:` paths (ignore blank `Disallow:` — that means
  "disallow nothing"). Return `false` iff `new URL(feedUrl).pathname` starts with
  any of them.
- **`Allow:` directives are not implemented** — a known, deliberate
  simplification (Review notes), acceptable because neither of this phase's two
  feed paths is expected to need one.

### S7 — `packages/db`: the write-side repository

Three new files under `packages/db/src/repositories/`, plain async functions
(no class, no interface — S1's "one implementation" reasoning), each taking
`db: Database` as its first argument, matching the existing style in
`packages/db/src/seed/sources.ts`:

**`sourceRepository.ts`**

```ts
export async function listIngestSources(db: Database, filterSlug?: string): Promise<IngestSource[]>;
// WHERE enabled AND (filterSlug IS NULL OR slug = filterSlug)

export async function updateSourceHealth(
  db: Database,
  sourceId: string,
  patch: {
    lastAttemptAt: Date;
    lastSuccessAt: Date | null; // null on failure — leaves the prior value via COALESCE
    consecutiveFailures: number; // caller computes: 0 on success, +1 on failure
    lastError: string | null;
    httpEtag: string | null;
    httpLastModified: string | null;
  },
): Promise<void>;
```

**`fetchRunRepository.ts`**

```ts
export async function startFetchRun(db: Database, sourceId: string): Promise<bigint>; // INSERT, status set at finish

export async function finishFetchRun(
  db: Database,
  fetchRunId: bigint,
  patch: {
    status: 'success' | 'partial' | 'error' | 'skipped_not_modified';
    httpStatus: number | null;
    itemsSeen: number;
    itemsNew: number;
    errorKind: string | null;
    errorMessage: string | null;
    durationMs: number;
  },
): Promise<void>;
```

`startFetchRun` inserts a row with `started_at = now()` and a placeholder status
(`'error'`, immediately overwritten by `finishFetchRun`) so a crash between start
and finish still leaves a row — observability survives the crash it is meant to
observe.

**`rawItemRepository.ts`**

```ts
export async function insertRawItems(
  db: Database,
  sourceId: string,
  fetchRunId: bigint,
  items: {
    url: string; // already canonicalised
    urlHash: Buffer; // sha256(url)
    contentHash: Buffer | null; // sha256(normalizeText(bodyText)), null if bodyText is null
    title: string | null;
    author: string | null;
    publishedAt: Date | null;
    excerpt: string | null;
    bodyText: string | null;
    imageUrl: string | null;
    rawPayload: unknown;
  }[],
): Promise<number>; // returns itemsNew — the count actually inserted
```

Implementation: one `INSERT ... ON CONFLICT (source_id, url_hash) DO NOTHING
RETURNING id` (Drizzle's `.onConflictDoNothing({ target: [rawItem.sourceId,
rawItem.urlHash] }).returning({ id: rawItem.id })`), batched as a single
multi-row insert — never one `INSERT` per item (N+1 rule). `RETURNING` only
yields the rows actually inserted, so `result.length` **is** `itemsNew` with no
separate count query. This is the idempotency guarantee (invariant 8): re-running
against the same feed inserts the same canonical URLs and all of them conflict.

`url_hash`/`content_hash` computation (`node:crypto`'s `createHash('sha256')`)
happens in `apps/ingest`, not inside this function or inside the adapter — the
adapter returns plain discovered content, `apps/ingest`'s fetch stage (S8)
canonicalises and hashes it, and this function only persists already-hashed rows.
Keeping `node:crypto` out of `packages/core` and `packages/sources` is deliberate:
core stays I/O-free by definition (invariant 4), and `packages/sources` should not
need to know this project's hashing scheme to add a tenth adapter later.

### S8 — `apps/ingest`: the CLI

```json
// apps/ingest/package.json
{
  "name": "@bitedrop/ingest",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@bitedrop/core": "*",
    "@bitedrop/db": "*",
    "@bitedrop/sources": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`apps/ingest/tsconfig.json` — same `extends`/`outDir`/`include` shape as
`packages/db/tsconfig.json`.

**`apps/ingest/src/cli.ts`** — parses argv with Node's built-in
`node:util parseArgs` (no new dependency):

```
--source=<slug>   optional; restricts the run to one source
--dry-run          optional; logs what would be inserted, writes nothing
--stage=<name>     optional, default "fetch"
```

**This phase implements only `--stage=fetch`.** Any other value throws
immediately with a message naming which phase owns it (`filter` → Phase 5,
`extract`/`normalize` → Phase 5/8, `dedupe` → Phase 6, `enrich` → Phase 9,
`publish` → Phase 5) — silently no-op-ing on an unimplemented stage would be
worse than a loud rejection.

**`apps/ingest/src/runFetchStage.ts`** — the orchestrator, one exported function
`runFetchStage(db, { sourceSlug, dryRun }): Promise<FetchStageSummary>`:

```
for each source in listIngestSources(db, sourceSlug):
  try:
    if not isFetchAllowed(source.url, USER_AGENT, 10_000):
      log, skip this source (no fetch_run row — nothing was attempted)
      continue
    fetchRunId = startFetchRun(db, source.id)
    adapter = getAdapter(source.type)              // registry: { rss: rssAdapter }
    result = adapter.fetch(source, { timeoutMs: 10_000, userAgent: USER_AGENT })
    if result.notModified:
      finishFetchRun(db, fetchRunId, { status: 'skipped_not_modified', itemsSeen: 0, itemsNew: 0, ... })
      updateSourceHealth(db, source.id, { consecutiveFailures: 0, lastError: null, ... })
      continue
    rows = result.items.map(hashAndCanonicalize)    // canonicalizeUrl + sha256, S7
    itemsNew = dryRun ? (log rows.length, 0) : insertRawItems(db, source.id, fetchRunId, rows)
    finishFetchRun(db, fetchRunId, { status: 'success', itemsSeen: rows.length, itemsNew, ... })
    updateSourceHealth(db, source.id, { consecutiveFailures: 0, lastError: null, httpEtag: result.etag, httpLastModified: result.lastModified, ... })
  catch (err):
    // per-source failure isolation — invariant 7. Never rethrow out of this loop body.
    if fetchRunId exists: finishFetchRun(db, fetchRunId, { status: 'error', errorKind: classify(err), errorMessage: String(err), ... })
    updateSourceHealth(db, source.id, { consecutiveFailures: previous + 1, lastError: String(err), ... })
    log and continue to the next source
```

`USER_AGENT` is the literal string `BiteDropBot/0.1 (+https://bite-drop.vercel.app)`
(`05-sources.md`'s operating rule), defined once as a constant.

**`--dry-run` never calls `insertRawItems`, `finishFetchRun`, or
`updateSourceHealth`** — it logs what each source would have produced and exits.
This makes it the safe command for probing a feed against production data without
the "do not run `db:seed` against Neon again" risk that already exists for the
seed script (phase-03 Outcome).

### S9 — Fixing the Phase 2 seed for these two sources

`packages/db/src/seed/sources.ts` currently gives every publication a placeholder
URL (the mock's base URL, not a real feed) and a flat `trustTier: 2`. Patch it —
**only for these two names**, leaving the other 6 untouched:

| `name` | new `url` | new `slug` | new `trustTier` | new `homepageUrl` |
|---|---|---|---|---|
| `'Brand Eating'` | `https://www.brandeating.com/feeds/posts/default?alt=rss` | `'brandeating-rss'` | `2` (unchanged) | `https://www.brandeating.com/` |
| `'PR Newswire'` | `https://www.prnewswire.com/rss/food-beverage-latest-news/food-beverage-latest-news-list.rss` | `'prnewswire-rss'` | `1` | `https://www.prnewswire.com/` |

This matters because `db:seed` is the **only** thing that currently populates
`source`, and it truncates first (phase-02 S7) — so without this fix, `npm run
ingest` would try to fetch the mock placeholder URL, not the real feed. It also
means `npm run db:seed` must **not** be run again once real `raw_item` rows exist
(already flagged in phase-03's Outcome) — this phase does not change that; it only
makes the pre-ingest seed state correct.

**Re-verify both live URLs still return 200 before relying on this table** — they
were last probed 2026-10-24, and feeds drift.

### S10 — Wiring: scripts, tsconfig, vitest

Root `package.json` scripts, add:

```json
"ingest": "tsx apps/ingest/src/cli.ts"
```

Root `tsconfig.json` — add to `paths`: `"@bitedrop/sources": [...]`; add to
`include`: `"packages/sources/src/**/*.ts"`, `"packages/sources/test/**/*.ts"`,
`"apps/ingest/src/**/*.ts"`, `"apps/ingest/test/**/*.ts"`.

`vitest.config.ts` gains one project, and one existing project's `include` grows:

```ts
{
  test: {
    name: 'sources',
    environment: 'node',
    include: ['packages/sources/test/**/*.test.ts'],
    // fixture-based, no network, no DB — same shape as 'core'
  },
},
```

`apps/ingest/test/**/*.test.ts` is added to the **existing `db` project's**
`include` array rather than given a fourth project — its tests need the same real
`TEST_DATABASE_URL` and the same truncate-between-files setup `db`'s tests already
have, and a new project would just duplicate that configuration.

### S11 — Required tests

**`packages/core/test/normalize.test.ts`** (extends the Phase 2 file)
- `canonicalizeUrl` strips `utm_source`/`utm_campaign` etc.; sorts remaining
  params; strips the fragment; two URLs differing only in tracking params or
  query order produce an identical result.

**`packages/core/test/source.test.ts`**
- `IngestSourceType`'s members equal `sourceTypeEnum`'s members in
  `packages/db/src/schema/enums.ts`, in order (the Phase 2 S4.2 pattern, applied
  to this enum).

**`packages/sources/test/adapters/rss.test.ts`** — against **recorded** fixtures
committed at `packages/sources/test/fixtures/brandeating.atom.xml` and
`.../prnewswire.rss.xml`. Re-fetch these fresh from the live URLs in S9's table
when implementing — the versions fetched during this phase's research were
cached only at `/tmp/brandeating.xml` / `/tmp/prnewswire.xml` and did not survive
to this session.
- Format detection picks RSS for the PR Newswire fixture, Atom for the Brand
  Eating fixture.
- **The landmine, explicitly:** parsing the Atom fixture's entries returns the
  `rel="alternate"` URL, not the `rel="replies"` or `rel="self"` one — assert
  against the known comments-feed URL to prove it was *not* picked.
- `bodyText` is truncated at 40,000 chars on a synthetic over-long entry.
- A 304 response (mock `fetch`) returns `notModified: true` and `items: []`,
  without attempting to parse a body.

**`packages/sources/test/robots.test.ts`**
- A 404/unreachable `robots.txt` → allowed.
- A `Disallow: /feeds/` group matching `User-agent: BiteDropBot` → blocked for a
  `/feeds/...` path.
- A `Disallow:` under `*` that does not match `BiteDropBot`'s own more specific
  group → the specific group wins.

**`packages/db/test/sourceRepository.test.ts`, `fetchRunRepository.test.ts`,
`rawItemRepository.test.ts`** — integration, real Postgres, no mocks (CLAUDE.md →
Testing):
- `insertRawItems` called twice with the same rows → second call's return value
  is `0` (idempotency, invariant 8).
- The same canonical URL inserted for two *different* `source_id`s succeeds for
  both — uniqueness is per-source, not global (02-data-model.md's design note).
- `updateSourceHealth` correctly resets `consecutive_failures` to 0 on success and
  increments it on failure.
- `startFetchRun`/`finishFetchRun` round-trip every `fetch_status` value.

**`apps/ingest/test/runFetchStage.test.ts`** — integration, real test database,
but **a fake `SourceAdapter`**, never a real network call (CLAUDE.md → Testing:
"no network in tests"):
- Two fake sources, one whose fake adapter throws: the failing source gets a
  `fetch_run` row with `status='error'` and its `consecutive_failures`
  incremented; the other source's items are still inserted. This is the test for
  invariant 7.
- Running the same fake adapter's fixed item list twice: second run's `itemsNew`
  is `0` across the board.
- `--dry-run` leaves `raw_item` and `fetch_run` row counts unchanged.
- `--source=<slug>` restricts the run to exactly one source.

### S12 — Do not do these things

1. Do not create any `FoodDrop`, or touch `food_drop`/`food_drop_source` — Phase 5.
2. Do not filter PR Newswire's noise — insert it as-is; filtering is Phase 5's job
   and this phase's whole point is proving the unfiltered path works.
3. Do not add the other 4 already-probed sources from `05-sources.md` — Phase 6/10.
4. Do not add `cheerio`, `undici`, or a Reddit/YouTube client — not needed until
   Phase 10.
5. Do not add an `IngestRepository` interface to `packages/core` — S1/S7's point.
6. Do not run `npm run db:seed` against Neon after this phase's `npm run ingest`
   has been run against it even once — it truncates `raw_item` (phase-03 Outcome).
7. Do not wire a cron or GitHub Actions schedule for `npm run ingest` — Phase 7.

---

## Acceptance criteria

**Fetch and parse**

- [x] 1 — `npm run ingest` fetches both Brand Eating and PR Newswire and inserts
      rows into `raw_item`.
- [x] 2 — The Atom-link landmine test (S11) passes: the article URL recorded is
      the `rel="alternate"` link, never the comments/self/edit link.
- [x] 3 — `raw_item.body_text` is never raw HTML and never exceeds 40,000 chars
      (invariant 5).
- [x] 4 — `raw_item.url` is canonicalised (no `utm_*`, sorted query, no fragment)
      before `url_hash` is computed from it.

**Idempotency and isolation**

- [x] 5 — Running `npm run ingest` twice in a row produces `itemsNew = 0` on the
      second run for both sources (invariant 8).
- [x] 6 — A thrown adapter error for one source does not stop the other source
      from being fetched and inserted (invariant 7), and is visible as a
      `fetch_run` row with `status='error'`.
- [x] 7 — `source.consecutive_failures` increments on a failed fetch and resets
      to 0 on a successful one.

**Protocol correctness**

- [x] 8 — `robots.txt` is checked before every real feed fetch, fails open on a
      missing/unreachable file, and blocks a path a matching `Disallow` covers.
- [x] 9 — A conditional GET is sent on every fetch once `http_etag` or
      `http_last_modified` is set from a prior run; a 304 response records
      `fetch_status='skipped_not_modified'` and inserts nothing.
- [x] 10 — Requests identify as `BiteDropBot/0.1 (+https://bite-drop.vercel.app)`.

**Architecture**

- [x] 11 — All SQL for this phase lives under `packages/db/src/repositories/`
      (invariant 1), checked by grep.
- [x] 12 — `packages/core` gains no I/O (invariant 4): `source.ts`'s new types
      have no function bodies beyond the one pure `canonicalizeUrl`.
- [x] 13 — `SourceAdapter`'s interface lives in `packages/core`; its only
      implementation lives in `packages/sources`.
- [x] 14 — `--dry-run` writes nothing to `raw_item`, `fetch_run`, or `source`.
- [x] 15 — `--stage=<anything but fetch>` fails loudly rather than no-op-ing.

**Hygiene**

- [x] 16 — `npm run check && npm test` pass, including the two new fixture files
      committed (no network in CI).
- [x] 17 — `IngestSourceType`'s members match `sourceTypeEnum` in the schema, in
      order, asserted by a test.

### Verification commands

```bash
npm run check && npm test

# fresh local DB, run ingest twice, confirm idempotency by eye
npm run db:reset
npm run ingest
psql "$DATABASE_URL" -c "SELECT source_id, count(*) FROM raw_item GROUP BY 1;"
npm run ingest
psql "$DATABASE_URL" -c "SELECT source_id, count(*) FROM raw_item GROUP BY 1;"   # unchanged

# no network calls inside the test suite
grep -rln "www.brandeating.com\|www.prnewswire.com" packages/sources/test apps/ingest/test \
  --include='*.test.ts'   # only the robots.test.ts/rss.test.ts fixture-URL assertions, no live fetch() calls

# only packages/db/src/repositories issues SQL for this phase's new code
grep -rl "drizzle-orm/pg-core\|\.insert(\|\.update(" packages/sources apps/ingest --include='*.ts'  # expect 0
```

## Review notes

Worth a second opinion, specifically:

- **No `IngestRepository` interface, by design (S1/S7).** This diverges from how
  `FoodDropRepository` was built — worth confirming the "second implementation"
  rule is being applied correctly here and not just used to skip work.
- **`robots.txt` support is `Disallow`-only; `Allow:` overrides are not
  implemented (S6).** Fine for these two feeds today; would need revisiting
  before Phase 10 adds sources with more elaborate `robots.txt` files.
- **`content_hash` is computed from the raw, unextracted `bodyText` (S7)** —
  there is no cleaning/extraction stage yet (that is Phase 5), so this is the
  best available signal today, but it means two sources that format the same
  press release with different whitespace/HTML won't content-hash equal. Revisit
  once Phase 5 adds real text extraction.
- **PR Newswire's trust_tier is set to `1`, Brand Eating's stays `2` (S9)** — this
  was already decided in `05-sources.md`; flagging only because it is the first
  phase where the number actually does something (nothing reads `trust_tier` yet,
  but Phase 6's dedupe will).
- ~~**PR Newswire is ~95% non-food noise.**~~ **Expected and documented** — see
  the warning banner at the top of this document. Not a defect to fix here.

---

## Outcome

### What changed

- **`packages/core/src/source.ts`** (new) — `IngestSourceType`, `IngestSource`,
  `DiscoveredItem`, `FetchContext`, `FetchResult`, `SourceAdapter`. Pure types,
  no I/O (invariant 4).
- **`packages/core/src/normalize.ts`** — added `canonicalizeUrl`.
- **`packages/sources`** (new package) — `adapters/rss.ts` (the Atom/RSS
  adapter and the `rel="alternate"` link-selection fix), `httpClient.ts`
  (timeout + retry), `robots.ts` (`robots.txt`), `stripHtml.ts` (HTML-tag and
  entity stripping — see Decisions), `registry.ts` (`getAdapter`), `index.ts`.
  Fixtures at `test/fixtures/*.xml` are real entries fetched live on
  2026-10-24 from both feeds, trimmed to 2–3 entries each.
- **`packages/db/src/repositories/{sourceRepository,fetchRunRepository,
  rawItemRepository}.ts`** (new) — plain async functions, no interface (see
  Plan's S1/S7 reasoning), exported from `packages/db/src/index.ts`.
- **`packages/db/src/seed/sources.ts`** — Brand Eating and PR Newswire now get
  real feed URLs, correct slugs, and PR Newswire's trust tier 1; every seeded
  source **except** those two is now `enabled: false` (see Decisions — not in
  the original plan).
- **`apps/ingest`** (new app) — `src/cli.ts`, `src/runFetchStage.ts` (the
  per-source fetch/dry-run orchestration), `src/hashItem.ts` (canonicalize +
  hash), `src/userAgent.ts`.
- **Wiring** — `tsconfig.base.json`/`tsconfig.json` paths and includes;
  `vitest.config.ts` gained a `sources` project and `apps/ingest/test/**`
  folded into the existing `db` project; root `package.json` gained the
  `ingest` script.
- **Tests** — `packages/core/test/normalize.test.ts` (canonicalizeUrl cases),
  `packages/db/test/schema.test.ts` (source_type enum parity, added to the
  existing file rather than a new one — see Decisions),
  `packages/sources/test/{adapters/rss,robots}.test.ts`,
  `packages/db/test/{sourceRepository,fetchRunRepository,rawItemRepository}.test.ts`,
  `apps/ingest/test/{runFetchStage.test.ts,testDb.ts}`.

### How to run it

```bash
npm run db:reset          # clean local Postgres, seeded
npm run ingest             # fetches both real sources
npm run ingest -- --source=brandeating-rss --dry-run
npm run ingest -- --stage=filter   # fails loudly: "not implemented until Phase 5"
```

### How to test it

```bash
npm run check && npm test   # 182 tests, all green, including the 2 new projects
npm run build                # apps/web still builds — this phase touched no web code
```

By hand, against the real local Postgres and the real live feeds (not fixtures):
reset, run `npm run ingest` twice in a row and confirm the second run's `new`
counts drop to 0 (or `skipped_not_modified` on a 304), then `--dry-run` and
confirm `raw_item`/`fetch_run` row counts are unchanged before/after. All of this
was run during this session — see Decisions for what it surfaced.

### Known limitations

- **`robots.txt` `Allow:` overrides are not implemented** (as planned, S6) —
  `Disallow`-only. Fine for these two feeds; revisit before Phase 10.
- **`content_hash` is computed from the raw, unextracted `bodyText`** (as
  planned) — no real text-extraction stage exists until Phase 5.
- **Brand Eating never returned a 304 in live testing** — PR Newswire did (on
  the second `npm run ingest` run), but Brand Eating's FeedBurner-proxied feed
  returned 200 both times even with `If-None-Match`/`If-Modified-Since` sent.
  Idempotency still holds (`ON CONFLICT DO NOTHING` doesn't depend on getting a
  304), but the bandwidth savings conditional GET is meant to provide may not
  materialize for this specific source. Not investigated further — not a
  correctness issue, just an efficiency one.
- **No test directly exercises `cli.ts`'s argument parsing or the
  `--stage=<other>` rejection** — verified by hand (`npm run ingest --
  --stage=filter` prints the expected "not implemented until Phase 5" error and
  exits non-zero) rather than in an automated test, since `cli.ts` is a thin
  wrapper over `runFetchStage` (which is fully tested) plus `node:util
  parseArgs`.

### Decisions made during implementation

- **Six of the eight seeded sources were switched to `enabled: false`** — not
  in the original plan. Discovered by actually running `npm run ingest` with no
  `--source` filter: it fetched all 8 enabled mock-seeded sources, not just the
  two real ones, because Phase 2's seed enables every source by default
  regardless of whether it has a real feed URL yet. The other 6 (The Takeout,
  Foodbeast, Delish, Eater, r/snackexchange, YouTube) still carry Phase 1/2
  placeholder URLs — mostly bare homepages — so the run spent its full
  retry/backoff budget on each one failing (`fast-xml-parser` choking on an
  HTML homepage with "Maximum nested tags exceeded", or a clean "unrecognized
  feed format"), and took over two minutes wall-clock for what should have
  been a two-source, few-second job. Fixed at the seed, not the orchestrator:
  `enabled` is exactly the column this situation means — Phase 6/10 flips each
  one back to `true` as it gets a real feed and a working adapter.
- **`cli.ts` was switched from `@bitedrop/db`'s `createDb()` to building its
  own `postgres()`/`drizzle()` client directly, closed with `sql.end()`** —
  also not in the original plan, and also found by actually running the
  command rather than only by its exit code. `createDb()` is designed for
  `apps/web`'s long-lived singleton (deliberately never closed — see Phase 2's
  `getDb()`), so using it in a one-shot CLI left the connection pool open and
  the process never exited; `npm run ingest` looked hung for two-plus minutes
  even though the actual fetch work had finished in under two seconds. The fix
  matches the pattern `migrate.ts`/`seed/run.ts` already use for the same
  reason.
- **A `stripHtml` step was added that the Plan's S4 field-mapping table didn't
  mention.** Invariant 5 ("never store raw HTML") reads as unconditional, not
  deferred to Phase 5's extraction stage, and both feeds' `description`/
  `content`/`content:encoded` fields are HTML. Added `packages/sources/src/
  stripHtml.ts` (tag stripping + a handful of entity decodes) and run every
  `excerpt`/`bodyText` through it before truncating. This is the one place
  implementation diverged from the written spec on a correctness requirement,
  not just a convenience.
- **The enum-parity test for `source_type` was added to the existing
  `packages/db/test/schema.test.ts`**, not a new `packages/core/test/
  source.test.ts` as S11 originally specified. `IngestSourceType` is a plain
  TS union (no Zod schema to import), so the only runtime check possible is
  against the database enum — which means the test has to live on the `db`
  side (where the enum is queryable), matching how `drop_status` parity is
  already tested, not on the `core` side where there's nothing to query
  against.
- **Live verification reproduced both of the prior session's findings
  exactly**, confirming the memory snapshot was still accurate: Brand Eating's
  `alt=rss` URL still 302s to a FeedBurner Atom feed with the same
  comments/edit/self/alternate multi-link shape on every entry, and PR
  Newswire's first 20 items were still ~95% non-food (securities-fraud
  notices, "HelloNation" sponsored content, a pharma trial, one Darden
  Restaurants employment lawsuit as the closest thing to food-adjacent).
- **`runFetchStage` ended up as two near-duplicate functions
  (`runDryRun`/`runReal`)** rather than one function with a `dryRun` branch
  threaded through it, specifically so dry-run provably never calls
  `startFetchRun`/`finishFetchRun`/`updateSourceHealth`/`insertRawItems` at
  all — a shared function with an `if (dryRun)` guard around each write call
  was harder to convince myself was correct by inspection than two short
  functions where the non-dry-run one is the only one importing the write
  functions it uses.

### Recommended next step

**Phase 5 — Filter + rule-based extraction.** `raw_item` now has real,
unfiltered rows from two live sources (132 rows after one local run: ~14 from
live ingestion, the rest from Phase 2's mock seed). The next meaningful gap is
exactly the one this phase's warning banner named: almost everything in there
is noise, and nothing yet separates a real product announcement from a
lawsuit notice. Before starting, it's worth deciding whether Phase 5's fixture
corpus should include real excerpts from this phase's two committed XML
fixtures (already representative of both "signal" and "noise") rather than
authoring new ones from scratch.
