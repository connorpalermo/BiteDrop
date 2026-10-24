# Phase 05 — Filter + rule-based extraction

| | |
|---|---|
| **Status** | Planned |
| **Planned** | 2026-10-24 |
| **Completed** | — |
| **Commits** | — (left in the working tree; commits are the repo owner's) |

**Goal.** Real `FoodDrop`s appear in the feed, built entirely from the `raw_item`
rows Phase 4 fetched — filtered and extracted with deterministic rules, zero LLM
calls, zero cost.

**Non-goals.** LLM extraction (Phase 8) · matching/merging across sources — **every
surviving candidate becomes its own new `FoodDrop` in this phase, deliberately**;
Phase 6 is what makes four sources collapse into one drop · retailers, regions, or
image mirroring (Phase 9) · trending computation (Phase 9 — the column stays `0`
for every drop this phase creates) · scheduling this on a cron (Phase 7) · the 4
other already-probed sources (Phase 6/10) · auto-creating new `Brand` rows (see S4 —
only the Phase 2 seeded brands can be matched) · a standalone "publish" sweep stage
(folded into extraction's confidence gate — see S6).

> **This document is a specification, not a sketch.** Every regex, threshold, and
> file path an implementer needs is stated here. If something is genuinely
> ambiguous, that is a defect in this document — **stop and ask rather than
> inventing an answer.**

> **These filter/extraction rules are deliberately simple and will both over- and
> under-match.** Nothing in this phase has access to a labelled corpus yet — the
> rules below are a first, reasoned pass against the real noise Phase 4 actually
> observed (securities-lawsuit notices, sponsored "HelloNation" filler, an
> unrelated science-summit release) and the real signal it found (Brand Eating's
> on-topic headlines). **The mechanism — named rules, a stored reason, a growing
> fixture corpus — is what this phase is actually building.** Treat today's
> precision as a starting point to iterate against, not a target already hit.

> **Every FoodDrop this phase creates has exactly one source and, almost always,
> no brand.** One source because dedupe/merging doesn't exist until Phase 6. No
> brand because this phase only *matches* against the 8 brands Phase 2's mock seed
> already created — it never creates a new one — and most real extracted titles
> won't mention Reese's, Oreo, or any of the other seven. **Both are expected.**

---

## Plan

### The one idea

Two new pure modules in `packages/core` (`filter.ts`, `extract.ts`) plus one new
package, `packages/llm`, that stands up the `LlmProvider` boundary **now**, with
`RuleBasedProvider` as its first implementation — exactly what
[`../01-architecture.md`](../01-architecture.md) §5 describes: *"Phases 1–7 ship
with zero LLM dependency. A `RuleBasedProvider` satisfies the same interface, so
the pipeline is complete and testable before any model is wired in."* `LlmProvider`
is on CLAUDE.md's named list of boundaries designed as seams from day one (next to
`FoodDropRepository` and `SourceAdapter`), so — like `SourceAdapter` in Phase 4 —
the interface goes in `packages/core` on its *first* implementation, not its
second.

`apps/ingest` grows two new stages, `filter` and `extract`, that — like `fetch` —
are independently re-runnable (`npm run ingest -- --stage=filter`) and
per-item failure-isolated: one bad candidate must not abort the batch.

### Scope: exactly what gets written for a surviving candidate

One `food_drop` row, one `food_drop_source` row (`role='primary'`,
`link_method='exact_url'`, `link_confidence=1.0` — the degenerate single-source
case, since no matching against other drops happens until Phase 6), zero
`food_drop_country` rows, zero `food_drop_retailer` rows. `published` is set at
insert time from a confidence gate (S6) — there is no separate "publish" pass to
run later, because nothing about a Phase-5-created drop changes after its one
insert until Phase 6 touches it.

### Stage ownership, and why `--stage=normalize`/`publish` aren't real flags

`../01-architecture.md` §3 lists Normalize (brand/category/date resolution) and
Publish as separate pipeline *stages*, but neither gets its own CLI flag:

- **Normalize is inseparable from Extract** in this phase — you cannot produce a
  structured field without resolving it (a category slug, a parsed date) in the
  same pass, so `--stage=extract` does both.
- **Publish has no backlog to sweep.** A Phase-5 drop's `published` value is
  decided once, at creation, from the confidence available at that moment. A
  standalone re-publish pass only becomes meaningful once Phase 6 can change a
  drop's `source_count`/confidence after the fact by merging more sources into it.

---

## Implementation spec

### S1 — `packages/core/src/filter.ts`: the Filter stage

Pure, no I/O (invariant 4). One exported entry point:

```ts
export interface FilterableItem {
  title: string | null;
  excerpt: string | null;
  bodyText: string | null;
  publishedAt: string | null; // ISO
  discoveredAt: string; // ISO
}

export interface FilterVerdict {
  passed: boolean;
  reason: string | null; // null iff passed; stored verbatim in raw_item.filter_reason
}

export function applyFilter(item: FilterableItem, now: Date = new Date()): FilterVerdict;
```

Rules run **in this order**; the first one that rejects wins, and its name is the
stored reason. Text matching runs against `` `${title ?? ''} ${excerpt ?? ''}` ``,
lowercased.

| Order | Reason (stored verbatim) | Rejects when text matches | Why this order |
|---|---|---|---|
| 1 | `legal_or_lawsuit_noise` | `/class action|securities fraud|shareholder|investors (have|face)|law firm|lawsuit|\bllp\b|deadline:/i` | The exact shape of Phase 4's live PR Newswire noise (`BBNX Deadline...Securities Fraud Lawsuit`, `ASTS...Class Action Lawsuit...Kessler Topaz...LLP`) |
| 2 | `sponsored_filler` | `/^in hellonation,|sponsored content|advertisement:/i` | PR Newswire's recurring sponsored local-business filler (`In HelloNation, Behavioral Health Experts...`) |
| 3 | `recipe_or_listicle` | `/\brecipe\b|how to make|\btop \d+\b|ranked:|\d+ (best|worst)/i` | Brief-named: "kills recipes ... listicles" |
| 4 | `review_or_opinion` | `/\breview\b|we tried|taste test|our verdict|hands-on/i` | Brief-named: "kills reviews" |
| 5 | `too_old` | `publishedAt ?? discoveredAt` is more than **30 days** before `now` | Brief-named: "kills ... old news" |
| 6 | `no_food_signal` | text matches **none** of the keywords in S1.1 below | The broadest, last-resort gate — catches everything else off-topic (a science-summit release, a pharma trial result) by the *absence* of any food signal, rather than trying to negatively enumerate every unrelated industry |

A `null`/empty `title` **and** `excerpt` **and** `bodyText` fails rule 6
immediately (nothing to signal on).

#### S1.1 — the food-signal keyword list (rule 6)

Deliberately broad — coverage matters more than precision here, since this is the
rule standing between "nothing published" and "everything published":

```
food|snack|drink|beverage|menu|flavor|flavour|restaurant|burger|pizza|taco|
sandwich|chicken|dessert|candy|chocolate|chip|soda|coffee|donut|doughnut|
cereal|sauce|cookie|ice cream|cream|edition|launch(es|ing)?|debut(s)?|
unveil(s)?|introduc(e|es|ing)
```

The last four (`launch`, `debut`, `unveil`, `introduce`) aren't food words — they're
**announcement-shaped language**, which is a real, general signal for "new product
news" independent of category, and is what lets a headline like *"Chick-fil-A
Unveils New Spicy Chick-fil-A Sauce"* pass even if every other keyword missed it.

### S2 — `packages/core/src/extract.ts`: the shared extraction contract

Just the Zod schema both a rule-based and a future cloud provider must agree on —
**no extraction logic lives here**, matching how the architecture doc treats the
schema as the shared contract and the provider as where the logic differs:

```ts
import { z } from 'zod';
import { categorySlugSchema, dropStatusSchema } from './schemas';

export const foodDropExtractionSchema = z.object({
  name: z.string().min(1).max(200),
  brandName: z.string().nullable(),
  categorySlug: categorySlugSchema,
  subcategory: z.string().nullable(),
  shortDescription: z.string().max(140),
  description: z.string(),
  status: dropStatusSchema,
  isLimitedTime: z.boolean(),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priceCents: z.number().int().nonnegative().nullable(),
  priceCurrency: z.string().length(3).nullable(),
  confidence: z.number().min(0).max(1),
});

export type FoodDropExtraction = z.infer<typeof foodDropExtractionSchema>;
```

Also add, to the existing `packages/core/src/normalize.ts`:

```ts
/** Truncates at the last whole word before maxLength, never mid-word —
 *  phase-02's shortDescription landmine, applied to extracted titles. */
export function truncateAtWord(value: string, maxLength: number): string;
```

### S3 — `packages/core/src/llm.ts`: the `LlmProvider` boundary

Transcribed from `../01-architecture.md` §5, with one deliberate adaptation: the
architecture doc's sketch uses a generic `JsonSchema` for `schema`; this project's
own rule is **"Zod schemas are the single source of truth"** (CLAUDE.md → Naming
and types), and Zod v4 can produce a real JSON Schema for a future cloud provider's
API via `z.toJSONSchema()` — so `schema` is typed as a Zod schema directly rather
than introducing a second, parallel schema representation.

```ts
export interface LlmError {
  kind: 'parse_error' | 'no_match' | 'provider_error';
  message: string;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface TokenBudget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface LlmExtractOptions<T> {
  schema: import('zod').ZodType<T>;
  prompt: string;
  input: string; // see S4 for what RuleBasedProvider expects this to contain
  budget?: TokenBudget; // unused until Phase 8's cloud provider
}

export interface LlmProvider {
  extract<T>(opts: LlmExtractOptions<T>): Promise<Result<T, LlmError>>;
}
```

`Result<T, E>` is this project's first use of the pattern CLAUDE.md → Errors
already names ("`Result<T, E>` for expected failures") — it didn't need a home
until this boundary existed.

### S4 — `packages/llm`: new package, `RuleBasedProvider`

```json
// packages/llm/package.json
{
  "name": "@bitedrop/llm",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "devDependencies": {
    "zod": "^4.0.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/llm/tsconfig.json` — same `extends`/`outDir`/`include` shape as every
other package. Wire into `tsconfig.base.json`/`tsconfig.json` paths and `include`
exactly like `packages/sources` was wired in Phase 4 S1.

**The `input` contract.** `LlmExtractOptions.input` is one string, but
`RuleBasedProvider` needs structured context (the candidate brand names to match
against, the source's trust tier) that a free-text field can't carry on its own.
Rather than inventing a second parameter the interface doesn't have, `input` is a
**JSON-encoded context object** — which is also realistic groundwork for Phase 8,
since prompting a real LLM to extract against a *specific* candidate-brand list is
the same "give it the context, then ask" shape:

```ts
export interface ExtractionInput {
  title: string | null;
  excerpt: string | null;
  bodyText: string | null;
  discoveredAt: string; // ISO
  sourceTrustTier: number;
  knownBrandNames: string[];
}
```

`apps/ingest`'s extract stage (S7) builds this object, `JSON.stringify`s it into
`input`, and writes a human-readable `prompt` describing the task — the prompt is
inert for `RuleBasedProvider` (it ignores the field entirely) but is still written
properly, since this is the interface's first real implementation, not a stub.

**`packages/llm/src/providers/rule-based.ts`:**

```ts
export const ruleBasedProvider: LlmProvider = {
  async extract(opts) {
    let context: ExtractionInput;
    try {
      context = JSON.parse(opts.input);
    } catch {
      return { ok: false, error: { kind: 'parse_error', message: 'input was not valid JSON' } };
    }

    const extraction = runHeuristics(context); // S4.1
    const parsed = opts.schema.safeParse(extraction);
    if (!parsed.success) {
      return { ok: false, error: { kind: 'parse_error', message: parsed.error.message } };
    }
    return { ok: true, value: parsed.data };
  },
};
```

Validating the heuristics' own output against `opts.schema` before returning is
deliberate: it is a second, independent check that a heuristic bug (an
out-of-range confidence, a category slug outside the canonical set) is caught
here rather than reaching `food_drop` and silently violating a constraint.

#### S4.1 — the heuristics (`runHeuristics`, same file or a sibling if it grows past
400 lines — split by responsibility, not line count, per CLAUDE.md → Size and
structure)

**`name` / `shortDescription` / `description`.** `name` is the article title,
**verbatim** — this phase does not attempt to extract a bare product name out of
an announcement-shaped headline ("Chick-fil-A Unveils New Spicy Chick-fil-A
Sauce" stays exactly that, not "Spicy Chick-fil-A Sauce"). That is a known,
named limitation (Review notes), not an oversight — doing it well needs real
language understanding, which is precisely Phase 8's job. `shortDescription` is
`truncateAtWord(title, 140)`. `description` is `bodyText ?? excerpt ?? ''`.

**`categorySlug`** — first matching regex wins, `'other'` if none match (the
column is `NOT NULL`, so this can never fail to resolve):

```
chips       /\bchips?\b|tortilla chip|potato chip/i
snacks      /\bsnack|pretzel|popcorn|cracker|jerky/i
candy       /candy|chocolate|gumm(y|ies)|caramel/i
desserts    /dessert|ice cream|donut|doughnut|cookie|\bcake\b|\bpie\b/i
drinks      /soda|beverage|\bdrink|coffee|latte|energy drink|juice/i
fast_food   /burger|taco|burrito|quesadilla|nugget|\bfries\b|mcdonald|taco bell|
            wendy|burger king|starbucks|dunkin|chick-fil-a|\bkfc\b|popeyes|
            subway|chipotle|pizza hut|domino/i
restaurants /restaurant|diner|opens (a |its )?new location/i
convenience /convenience store|7-eleven|circle k/i
seasonal    /halloween|christmas|pumpkin spice|holiday edition/i
grocery     /grocery|supermarket/i
other       (fallback)
```

**`subcategory`** — always `null` in this phase.

**`brandName`** — case-insensitive substring search of `context.knownBrandNames`
against `title + excerpt`, **longest name first** (so "Taco Bell" is tried before
a hypothetical shorter "Taco" would be, avoiding a partial match stealing the
slot). `null` if nothing matches — **no new `Brand` row is ever created here.**

**`status` / `isLimitedTime` / confidence's hedge cap** — checked in this order,
first match wins, else `'new'`:

```
rumored       /\brumor(ed)?\b|reportedly|leaked|spotted at|might (launch|arrive)|
              could (be|launch)/i   → confidence capped at 0.4 (see below)
returning     /\bis back\b|\breturns?\b|returning to/i
coming_soon   /coming soon|launching (soon|next|this)|will (launch|debut|arrive)/i
limited_time  /limited[- ]time|limited[- ]edition|while supplies last/i
              → also sets isLimitedTime: true regardless of which status wins
```

**`releaseDate`** — `/\b(January|February|...|December)\s+\d{1,2},?\s+\d{4}\b/`
against title+excerpt; parsed with `new Date(...)`, formatted
`.toISOString().slice(0, 10)`. `null` if no match or the parse is invalid.

**`priceCents` / `priceCurrency`** — `/\$\s?(\d+(?:\.\d{2})?)/`; first match,
`Math.round(parseFloat(match[1]) * 100)`, currency hardcoded `'USD'`
(international currency parsing is out of scope). Both `null` if no match.

**`confidence`** — base rate from `context.sourceTrustTier` (`1` → `0.7`, else
`0.5` — PR Newswire's first-party status earns a higher floor than Brand Eating's
reputable-but-secondary coverage), **+0.15** if a brand matched, **+0.1** if
`categorySlug !== 'other'`, **+0.05** if `releaseDate` was found, then **capped at
0.4** if the hedge-language rule fired, clamped to `[0, 1]`.

### S5 — `packages/db`: new repositories

Two new files, plain functions (no interface — same one-implementation reasoning
as Phase 4's `sourceRepository`/`fetchRunRepository`/`rawItemRepository`), exported
from `packages/db/src/index.ts`:

**`filterRepository.ts`**

```ts
export async function listDiscoveredRawItems(db: Database, sourceId?: string): Promise<FilterableRawItem[]>; // stage='discovered'

export async function applyFilterVerdicts(
  db: Database,
  verdicts: { rawItemId: string; passed: boolean; reason: string | null }[],
): Promise<void>;
```

`applyFilterVerdicts` runs as one transaction of individual `UPDATE raw_item SET
stage = ..., filter_reason = ... WHERE id = ...` statements — **this is not the
N+1 pattern CLAUDE.md warns about.** That rule targets request-serving reads;
this is a batch job writing a bounded number of rows once per run, and a
multi-row `UPDATE ... FROM (VALUES ...)` would buy nothing but complexity at this
volume.

**`extractRepository.ts`**

```ts
export async function listCandidateRawItems(db: Database, sourceId?: string): Promise<CandidateRawItem[]>; // stage='candidate', joined to source for trustTier

export async function listKnownBrandNames(db: Database): Promise<string[]>;

/** One transaction: insert food_drop, insert its one food_drop_source row,
 *  set raw_item.stage = 'linked'. */
export async function createFoodDropFromExtraction(
  db: Database,
  rawItem: CandidateRawItem,
  extraction: FoodDropExtraction,
  brandId: string | null,
): Promise<void>;

export async function markRawItemFailed(db: Database, rawItemId: string, message: string): Promise<void>; // stage='failed', last_error, attempt_count += 1
```

`createFoodDropFromExtraction`'s `slug` is **deterministic**, not
retry-on-conflict: `` `${slugify(extraction.name)}-${rawItem.urlHash.toString('hex').slice(0, 6)}` ``
— stable if the stage is ever re-run, and avoids a conflict-and-retry loop. Fields
not covered above: `normalizedName`/`searchText` via the existing
`normalizeName`/`composeSearchText` (Phase 2, unchanged), `firstSeenAt =
rawItem.discoveredAt`, `sourceCount = 1`, `trendingScore = 0` (Phase 9 computes),
`published` — see S6.

### S6 — The publish gate

```ts
const PUBLISH_CONFIDENCE_THRESHOLD = 0.6;

const published = extraction.status !== 'rumored' && extraction.confidence >= PUBLISH_CONFIDENCE_THRESHOLD;
```

The explicit `status !== 'rumored'` check is belt-and-suspenders: the hedge-language
rule (S4.1) already caps confidence at `0.4`, which alone would fail the `0.6`
threshold — but invariant 12 ("never present an unconfirmed release as fact") is
important enough to check directly rather than depend on one arithmetic cap never
changing.

### S7 — `apps/ingest`: the two new stages, and `cli.ts`'s rewrite

**`runFilterStage.ts`** — read `listDiscoveredRawItems` (optionally `--source`
scoped), run `applyFilter` per row, batch-write via `applyFilterVerdicts`.
`--dry-run` logs the would-be pass/reject counts and reasons without writing.

**`runExtractStage.ts`** — read `listCandidateRawItems` + `listKnownBrandNames`
once per run; for each candidate, build the `ExtractionInput`, call
`ruleBasedProvider.extract(...)`, and on `ok: true` call
`createFoodDropFromExtraction`; on `ok: false` call `markRawItemFailed` with the
error message. **Wrap each candidate's handling in its own try/catch** — one
malformed candidate must not abort the batch, the same per-item isolation
philosophy as Phase 4's per-*source* isolation, applied one level down.
`--dry-run` logs what would be created (and its `published` value) without
writing.

**`cli.ts`** — the default run (no `--stage`) now runs **fetch, then filter, then
extract**, in that order, each scoped by `--source` if given. `--stage=fetch` /
`--stage=filter` / `--stage=extract` run exactly one of those, skipping the rest.
Update the stage-rejection map:

```ts
const STAGE_OWNERS: Record<string, string> = {
  normalize: 'folded into --stage=extract, not a separate stage',
  dedupe: 'Phase 6',
  enrich: 'Phase 9',
  publish: 'there is no separate publish stage — see docs/phases/phase-05-filter-extract.md §"Stage ownership"',
};
```

### S8 — Housekeeping: a stale comment from Phase 4's planning

`packages/db/src/schema/enums.ts`'s `itemStageEnum` comment and
[`phase-02-database.md`](./phase-02-database.md) S4.2 both say *"Phase 4 owns the
pipeline and may revise [`item_stage`]."* Phase 4 turned out to own only Fetch and
never touched `item_stage` beyond writing `'discovered'`. Phase 5 is the actual
owner — fix both comments to say so. (The enum's six members already fit Phase 5
exactly as designed above; no schema migration is needed, only the comment is
wrong.)

### S9 — Wiring: scripts, tsconfig, vitest

No new root script — `npm run ingest` already covers the new default behaviour.
`tsconfig.base.json`/`tsconfig.json`: add `@bitedrop/llm` path + `packages/llm/
src|test/**` to `include`, same pattern as Phase 4 S1/S10.

`vitest.config.ts` gains one project:

```ts
{
  test: {
    name: 'llm',
    environment: 'node',
    include: ['packages/llm/test/**/*.test.ts'],
    // pure heuristics, no network, no DB — same shape as 'core'/'sources'
  },
},
```

`apps/ingest/test/{runFilterStage,runExtractStage}.test.ts` join the existing `db`
project's `include`, same reasoning as Phase 4's `runFetchStage.test.ts`.

### S10 — Required tests

**`packages/core/test/filter.test.ts`** — one case per rule in S1's table, each
asserting the exact `reason` string; a title with no signal at all rejected as
`no_food_signal`; a real Brand Eating-shaped title ("X Unveils Y") and a real
on-topic PR Newswire-shaped title both pass; the three real noise titles observed
live in Phase 4 (`BBNX Deadline...`, `In HelloNation...`, `World Young Scientist
Summit...`) are each rejected, asserting which specific rule caught each one.

**`packages/core/test/normalize.test.ts`** — `truncateAtWord` never cuts mid-word
and respects the max length.

**`packages/llm/test/providers/rule-based.test.ts`**
- category keyword table: one case per slug in S4.1's list, plus the `'other'`
  fallback for a title matching none of them.
- brand matching: longest-name-first (a title containing two known brand
  substrings where one is a prefix of the other resolves to the longer one);
  `null` when no known brand appears.
- hedge language forces `status: 'rumored'` and caps confidence at `0.4` even
  when every other heuristic hits.
- `returning`/`coming_soon`/`limited_time` each fire on their regexes, in
  priority order when more than one could apply.
- price/date regexes: a real "$4.99" and a real "November 16, 2026" extract
  correctly; absence of either leaves both `null`.
- the JSON-input parse failure path returns `{ ok: false, error: { kind:
  'parse_error' } }`.
- a deliberately broken heuristic output (confidence `1.5`, injected via a test
  double) is caught by the `opts.schema.safeParse` check, not inserted.

**`packages/db/test/{filterRepository,extractRepository}.test.ts`** — integration,
real Postgres, no mocks: `listDiscoveredRawItems`/`listCandidateRawItems` scope
correctly by stage and optional `sourceId`; `applyFilterVerdicts` moves rows to
the right stage with the right `filter_reason`; `createFoodDropFromExtraction`
produces exactly one `food_drop_source` row and sets `source_count = 1`;
`markRawItemFailed` sets `stage='failed'` and increments `attempt_count`.

**`apps/ingest/test/{runFilterStage,runExtractStage}.test.ts`** — integration,
real test DB, fixture-shaped rows (no network): per-item failure isolation (one
candidate that fails `schema.safeParse` doesn't block the next one from creating
its `food_drop`); `--dry-run` leaves `food_drop`/`raw_item.stage` unchanged;
re-running `--stage=filter` twice over the same already-`candidate` rows is a
no-op (nothing left in `discovered` to re-filter).

---

## Acceptance criteria

**Filter**

- [ ] 1 — `npm run ingest -- --stage=filter` moves every `discovered` row to
      `candidate` or `rejected`, with `filter_reason` set on every rejection.
- [ ] 2 — Each of the three real noise titles observed live in Phase 4 is rejected
      by the rule named for it in S1's table.
- [ ] 3 — A real Brand Eating-shaped announcement title passes.

**Extract**

- [ ] 4 — `npm run ingest -- --stage=extract` creates exactly one `food_drop` and
      one `food_drop_source` row per surviving `candidate`, and sets that
      `raw_item.stage` to `linked`.
- [ ] 5 — A candidate whose extracted output fails `foodDropExtractionSchema`
      validation is marked `failed` with a `last_error`, and does not block
      extraction of the next candidate (per-item isolation).
- [ ] 6 — `brandId` is set only when a Phase 2 seeded brand name appears in the
      text; no new `brand` row is ever created by this phase.
- [ ] 7 — Hedge language (`rumored`, `reportedly`, ...) always produces
      `status='rumored'` and `confidence <= 0.4`.
- [ ] 8 — `published = true` iff `status !== 'rumored'` and `confidence >= 0.6`.

**Architecture**

- [ ] 9 — `LlmProvider`'s interface lives in `packages/core`; `RuleBasedProvider`
      is its only implementation, in `packages/llm`.
- [ ] 10 — All SQL for this phase lives under `packages/db/src/repositories/`
      (invariant 1).
- [ ] 11 — `packages/core` gains no I/O (invariant 4): `filter.ts`/`extract.ts`
      are pure.
- [ ] 12 — `--stage=dedupe`/`enrich`/`publish`/`normalize` each fail loudly with
      the clarifying message from S7's `STAGE_OWNERS` map.
- [ ] 13 — `--dry-run` writes nothing for either new stage.

**Hygiene**

- [ ] 14 — `npm run check && npm test` pass, including the new `llm` project.
- [ ] 15 — The stale "Phase 4" comment in `enums.ts`/`phase-02-database.md` (S8)
      is corrected.

### Verification commands

```bash
npm run check && npm test

npm run db:reset
npm run ingest   # fetch, then filter, then extract, end to end
npx tsx -e "
(async () => {
  const { config } = await import('dotenv'); config({ path: '.env.local' });
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  console.log(await sql\`SELECT name, status, confidence, published FROM food_drop ORDER BY created_at DESC LIMIT 10\`);
  console.log(await sql\`SELECT stage, filter_reason, count(*) FROM raw_item GROUP BY 1, 2 ORDER BY 1\`);
  await sql.end();
})();
"

# no SQL leaks outside packages/db/src/repositories for this phase's new code
grep -rl "drizzle-orm/pg-core\|\.insert(\|\.update(" packages/core packages/llm apps/ingest/src --include='*.ts'  # expect 0
```

## Review notes

Worth a second opinion, specifically:

- **Every keyword list and threshold in S1/S4.1/S6 is a genuine judgment call with
  no objectively "right" answer yet** — the `0.6` publish threshold, the `0.15`/
  `0.1`/`0.05` confidence bumps, and every regex. They're each individually
  reasoned (tied to a real example where possible), but there's no labelled
  corpus to validate against until this phase itself creates the first rows to
  eyeball. Expect to revise these quickly after seeing real output.
- **No new `Brand` row is ever auto-created (S4.1).** This means most real
  extracted items — anything not mentioning one of Phase 2's 8 mock brands — will
  have `brand_id = null`. That's defensible (a wrong brand match is worse than no
  match) but means the brand filter/facet will look sparse for a while. Worth
  confirming that's the right trade rather than a surprise.
- **`name` is the raw headline, not an extracted product name (S4.1).** "Chick-
  fil-A Unveils New Spicy Chick-fil-A Sauce" stays exactly that rather than
  becoming "Spicy Chick-fil-A Sauce." Doing better needs real language
  understanding — explicitly deferred to Phase 8, not an oversight, but worth
  seeing how it looks on a real card before agreeing it's acceptable for two
  phases' worth of time.
- **The `input`-as-JSON-string design for `LlmProvider.extract` (S4)** is an
  adaptation of the architecture doc's sketch, not a literal transcription.
  Reasoned through in S4, but it's the first real implementation of a boundary
  CLAUDE.md flags as pre-designed, so it's worth confirming the adaptation holds
  up before Phase 8 builds a second provider against it.

---

## Outcome

*Filled in at completion. Everything below is written after the work, not before.*

### What changed

—

### How to run it

—

### How to test it

—

### Known limitations

—

### Decisions made during implementation

—

### Recommended next step

—
