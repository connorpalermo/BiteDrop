# Phase 01 — UI prototype on mock data

| | |
|---|---|
| **Status** | Planned |
| **Planned** | 2026-09-11 |
| **Completed** | — |
| **Commits** | — |

**Goal.** The BiteDrop discovery feed — feed, filters, search, detail pages,
responsive, light and dark — running on mock data with no database.

**Non-goals.** Postgres · Drizzle · real HTTP · ingestion · auth · the agent ·
image mirroring · analytics · deployment (Phase 3).

> **This document is a specification, not a sketch.** It is deliberately
> prescriptive: every literal value, type, threshold, and file path an
> implementer needs is stated here rather than left to judgment. If something is
> genuinely ambiguous, that is a defect in this document — stop and ask rather
> than inventing an answer.

---

## Plan

### The one idea that makes Phase 2 cheap

Phase 1 defines the domain types and the repository interface that Phase 2 will
implement against Postgres. The UI talks **only** to that interface.

Phase 1 ships `MockFoodDropRepository`. Phase 2 ships `PgFoodDropRepository`
satisfying the same contract, with **no UI component changes**. That is why the
cursor is opaque from day one — a mock returning page numbers would make Phase 2 a
UI refactor instead of a swap.

---

## Implementation spec

### S1 — Versions and scaffold

Pin these majors. Use the latest stable patch of each; record exact versions in
`package-lock.json`.

| Package | Major |
|---|---|
| Node | 22 (`.nvmrc` → `22`) |
| next | 16 |
| react / react-dom | 19 |
| typescript | 5 |
| tailwindcss | 4 |
| zod | 4 |
| vitest | 3 |
| eslint / prettier | latest stable |

Workspace root `package.json`:

```json
{
  "name": "bitedrop",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "npm run dev -w @bitedrop/web",
    "build": "npm run build -w @bitedrop/web",
    "test": "vitest run",
    "check": "tsc --noEmit && eslint . && prettier --check ."
  }
}
```

Package names: `@bitedrop/web`, `@bitedrop/core`.

`packages/core/package.json` must declare the subpath export the web app imports,
or `@bitedrop/core/mock` will not resolve:

```json
{
  "name": "@bitedrop/core",
  "type": "module",
  "exports": {
    ".":      "./src/index.ts",
    "./mock": "./src/mock/index.ts"
  }
}
```

Add `"@bitedrop/core": ["packages/core/src/index.ts"]` and
`"@bitedrop/core/mock": ["packages/core/src/mock/index.ts"]` to the
`tsconfig.base.json` paths, and `transpilePackages: ['@bitedrop/core']` to
`apps/web/next.config.ts`.
**ESLint must enforce the limits in `CLAUDE.md` → Code standards** from the first
commit, because retrofitting `max-lines` onto an existing codebase is painful:

```js
// eslint.config.js (flat config)
rules: {
  'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-params': ['error', 4],
  'complexity': ['error', 12],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  'import/no-default-export': 'error',
}
```

Two exemption blocks are required, or the config contradicts this spec:

```js
// mock data is flat fixture data — 40 drops is ~800 lines and splitting buys nothing
{ files: ['packages/core/src/mock/**'], rules: { 'max-lines': 'off' } },
// Next.js requires default exports from pages, layouts, and route files
{ files: ['apps/web/app/**/{page,layout,error,loading,not-found,route}.tsx',
          'apps/web/app/**/{page,layout,error,loading,not-found,route}.ts',
          'apps/web/next.config.ts'],
  rules: { 'import/no-default-export': 'off' } },
```

`tsconfig.base.json` sets `"strict": true` and path alias
`"@bitedrop/core": ["packages/core/src"]`. `apps/web/tsconfig.json` extends it and
adds `"@/*": ["./*"]`.

### S2 — Reference data (exact literals)

These are the complete, closed sets for Phase 1. Do not add or rename members.

**Categories** — `packages/core/src/reference.ts`:

| slug | name | emoji |
|---|---|---|
| `fast_food` | Fast Food | 🍔 |
| `restaurants` | Restaurants | 🍽️ |
| `candy` | Candy | 🍫 |
| `snacks` | Snacks | 🍿 |
| `chips` | Chips | 🥔 |
| `drinks` | Drinks | 🥤 |
| `desserts` | Desserts | 🍦 |
| `grocery` | Grocery | 🛒 |
| `convenience` | Convenience | 🏪 |
| `seasonal` | Seasonal | 🎃 |
| `other` | Other | ✨ |

**Statuses** — display label and badge treatment:

| value | label | badge |
|---|---|---|
| `new` | New | solid accent fill, white text |
| `coming_soon` | Coming Soon | outline, `--text` |
| `limited_time` | Limited Time | solid amber fill, near-black text |
| `returning` | Returning | outline, `--text` |
| `discontinued` | Discontinued | solid `--surface-2` fill, `--text-3` |
| `rumored` | Unconfirmed | **dashed** outline, `--text-3` |

Only two hues carry status (accent, amber); the rest differ by treatment. This is
deliberate — the brief asks not to mix many unrelated colours.

**Countries**:

| code | name | emoji | region |
|---|---|---|---|
| `US` | United States | 🇺🇸 | `north_america` |
| `CA` | Canada | 🇨🇦 | `north_america` |
| `MX` | Mexico | 🇲🇽 | `north_america` |
| `JP` | Japan | 🇯🇵 | `asia` |
| `KR` | South Korea | 🇰🇷 | `asia` |
| `GB` | United Kingdom | 🇬🇧 | `europe` |
| `DE` | Germany | 🇩🇪 | `europe` |
| `FR` | France | 🇫🇷 | `europe` |
| `AU` | Australia | 🇦🇺 | `oceania` |

**Retailers** — `slug` / `name` / `type`:
`target`/Target/`mass` · `walmart`/Walmart/`mass` · `costco`/Costco/`mass` ·
`kroger`/Kroger/`grocery` · `cvs`/CVS/`pharmacy` · `walgreens`/Walgreens/`pharmacy` ·
`seven_eleven`/7-Eleven/`convenience` · `circle_k`/Circle K/`convenience` ·
`amazon`/Amazon/`online` · `mcdonalds`/McDonald's/`restaurant` ·
`taco_bell`/Taco Bell/`restaurant` · `wendys`/Wendy's/`restaurant` ·
`burger_king`/Burger King/`restaurant` · `starbucks`/Starbucks/`restaurant` ·
`dunkin`/Dunkin'/`restaurant` · `chick_fil_a`/Chick-fil-A/`restaurant`

### S3 — Domain types (`packages/core/src/types.ts`)

Define with Zod in `schemas.ts` and infer these types from the schemas — do not
hand-write both.

```ts
export type DropStatus =
  | 'new' | 'coming_soon' | 'limited_time'
  | 'returning' | 'discontinued' | 'rumored';

export type CategorySlug =
  | 'fast_food' | 'restaurants' | 'candy' | 'snacks' | 'chips' | 'drinks'
  | 'desserts' | 'grocery' | 'convenience' | 'seasonal' | 'other';

export type CountryCode = 'US' | 'CA' | 'MX' | 'JP' | 'KR' | 'GB' | 'DE' | 'FR' | 'AU';
export type Region = 'north_america' | 'asia' | 'europe' | 'oceania';
export type SortKey = 'newest' | 'trending';

export interface BrandRef   { slug: string; name: string }
export interface CategoryRef{ slug: CategorySlug; name: string; emoji: string }
export interface CountryRef { code: CountryCode; name: string; emoji: string; region: Region }
export interface RetailerRef{ slug: string; name: string }

export interface SourceRef {
  id: string;
  sourceName: string;        // "Brand Eating"
  title: string;             // article headline
  url: string;
  publishedAt: string | null;// ISO 8601
  discoveredAt: string;      // ISO 8601
  isPrimary: boolean;
}

/** Shape the feed card needs — nothing more. */
export interface FoodDropSummary {
  id: string;
  slug: string;
  name: string;
  brand: BrandRef | null;
  category: CategoryRef;
  subcategory: string | null;
  shortDescription: string;            // ≤ 140 chars, for the card
  status: DropStatus;
  isLimitedTime: boolean;
  releaseDate: string | null;          // ISO date, no time
  availabilityStart: string | null;
  availabilityEnd: string | null;
  priceCents: number | null;
  priceCurrency: string | null;        // ISO 4217, e.g. "USD"
  imageUrl: string | null;
  countries: CountryRef[];             // ordered, primary first
  retailers: RetailerRef[];            // may be empty
  sourceCount: number;
  firstSeenAt: string;                 // ISO 8601 — powers "discovered X ago"
  trendingScore: number;
}

export interface FoodDropDetail extends FoodDropSummary {
  description: string;                 // full prose, may be multi-paragraph
  confidence: number;                  // 0..1
  sources: SourceRef[];                // length === sourceCount
  relatedBySameBrand: FoodDropSummary[];    // ≤ 4
  relatedBySameCategory: FoodDropSummary[]; // ≤ 4
}

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface FacetCount<T> { value: T; label: string; count: number }
export interface Facets {
  categories: FacetCount<CategorySlug>[];
  countries:  FacetCount<CountryCode>[];
  statuses:   FacetCount<DropStatus>[];
  brands:     FacetCount<string>[];    // brand slug; sorted by count desc, then name
}
```

### S4 — Repository contract (`packages/core/src/repository.ts`)

```ts
export interface FeedQuery {
  cursor?: string;                 // opaque; from a previous Page.nextCursor
  limit: number;                   // caller always passes; see PAGE_SIZE
  categories?: CategorySlug[];
  countries?: CountryCode[];
  statuses?: DropStatus[];
  brandSlugs?: string[];
  search?: string;
  sort: SortKey;
}

export interface FoodDropRepository {
  list(q: FeedQuery): Promise<Page<FoodDropSummary>>;
  getBySlug(slug: string): Promise<FoodDropDetail | null>;
  facets(): Promise<Facets>;
}

export const PAGE_SIZE = 12;
```

`facets()` returns counts over the **entire** data set, not the filtered subset.
Phase 1 keeps it that way so counts do not shift as filters are applied.

#### Filter semantics — exact

- **Within one facet: OR.** `categories: ['candy','snacks']` matches either.
- **Across facets: AND.** Categories AND countries AND statuses AND brands AND search.
- An **absent or empty** array means "no constraint from this facet".
- `countries` matches if **any** of the drop's countries is in the list.
- `search` (after trimming) matches case- and diacritic-insensitively as a
  **substring** against, in this order: `name`, `brand.name`, `shortDescription`,
  `subcategory`. Empty/whitespace-only search is treated as absent.
- Normalisation for search: `.toLowerCase()` then
  `.normalize('NFD').replace(/\p{Diacritic}/gu,'')` on both haystack and needle.

#### Sort and cursor — exact

Sort keys, both **descending**, with `id` descending as the tiebreak so ordering is
total and stable:

- `newest` → primary value is `firstSeenAt` (ISO string; compare lexicographically)
- `trending` → primary value is `trendingScore` (number)

Cursor format — base64url of JSON:

```ts
// encode
const cursor = base64url(JSON.stringify({ v: primaryValue, id: lastItemId }));
// decode: reject anything that does not parse to { v: string|number, id: string }
```

Paging rule: return items strictly **after** the cursor position under the tuple
comparison `(primaryValue, id)` descending. `nextCursor` is `null` when the page
returned fewer than `limit` items; otherwise it encodes the last item on the page.

An unparseable or malformed cursor must **throw** a typed error, not silently
return page one — silent fallback hides the exact bug this criterion guards.

### S5 — Mock data (`packages/core/src/mock/data.ts`)

**40 hand-authored drops.** Write them out literally as a typed array.

Do **not** write a random or seeded generator. Generated names like
"Brand Product 7" would make the feed impossible to review, and judging whether
the UI feels good is the entire point of this phase.

Coverage requirements — assert these in a test:

- All 11 categories appear at least once.
- All 6 statuses appear at least once.
- At least 5 countries appear; at least 4 drops are non-`US`.
- At least 3 drops have **2 or more** countries (exercises the multi-flag layout).
- `sourceCount` ranges 1–9; at least one drop has `sourceCount === 1` and at least
  one has `sourceCount >= 5`.
- `firstSeenAt` values spread across: minutes ago, hours ago, days ago, weeks ago,
  and >2 months ago (exercises every relative-time branch).
- **Missing-field coverage** — at least two drops each with:
  `imageUrl === null`, `priceCents === null`, `retailers === []`,
  `brand === null`, `releaseDate === null`, `subcategory === null`.

Every `firstSeenAt` must be a **fixed ISO literal**, never `Date.now()`-relative —
relative values make snapshot tests and review non-reproducible. Put the literals
in the past relative to a documented `MOCK_NOW` constant, and have the relative-time
formatter accept an injectable `now` so tests are deterministic.

`imageUrl` values: use `https://images.unsplash.com/photo-...` food photos, and add
`images.unsplash.com` to `next.config.ts` `images.remotePatterns`.

**Verify every URL before declaring the step done** — a fixture set with broken
images fails criterion 2 and wastes review time:

```bash
grep -oE 'https://images\.unsplash\.com[^"]+' packages/core/src/mock/data.ts \
  | sort -u | while read -r u; do
      printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 10 "$u")" "$u"
    done
```

Every line must start `200`. Replace anything that does not.

### S6 — Design tokens (`apps/web/styles/tokens.css`)

Exact values. All colour use goes through these variables; no literal colours
anywhere else in the codebase.

```css
:root {
  /* neutrals — warm-biased toward the accent */
  --bg:        #FFFBF8;
  --surface:   #FFFFFF;
  --surface-2: #F7F1ED;
  --border:    #E8DED7;
  --text:      #1A1310;
  --text-2:    #6B5D55;
  --text-3:    #9C8C83;

  /* accents — only two hues in the whole product */
  --accent:       #E8431F;
  --accent-hover: #CC3A1A;
  --accent-fg:    #FFFFFF;
  --amber:        #E08700;
  --amber-fg:     #1A1310;

  --focus: #E8431F;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  --shadow-card: 0 1px 2px rgb(26 19 16 / 6%), 0 4px 12px rgb(26 19 16 / 5%);

  /* type scale */
  --fs-xs: .75rem;  --fs-sm: .875rem; --fs-base: 1rem;
  --fs-lg: 1.125rem; --fs-xl: 1.375rem; --fs-2xl: 1.75rem; --fs-3xl: 2.5rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:        #12100F;
    --surface:   #1C1917;
    --surface-2: #262220;
    --border:    #332E2A;
    --text:      #F7F3F0;
    --text-2:    #B5A9A1;
    --text-3:    #857A73;
    --accent:       #FF6B45;
    --accent-hover: #FF8163;
    --accent-fg:    #1A1310;
    --amber:        #F0A829;
    --amber-fg:     #1A1310;
    --focus:        #FF6B45;
    --shadow-card: 0 1px 2px rgb(0 0 0 / 40%), 0 4px 12px rgb(0 0 0 / 30%);
  }
}

/* Write out every declaration from the dark block again here — literally all
   18 custom properties. Do not use a comment, @apply, or a shared class: an
   explicit duplicate is what makes the manual toggle win in both directions. */
:root[data-theme="dark"] { --bg: #12100F; /* …and the rest, in full… */ }
```

Three theme states must work: `data-theme="dark"`, `data-theme="light"`, and
**no attribute at all** (the default, where only `prefers-color-scheme` applies).
Never define a colour only inside a media query or `[data-theme]` block.

**Fonts** via `next/font/google` in `app/layout.tsx` — two families, no more:

```ts
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from 'next/font/google';
// Both are VARIABLE fonts — do NOT pass `weight`. next/font errors on a weight
// array for a variable face; the full range is available via font-weight in CSS.
const display = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-display' });
const body    = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-body' });
```

Apply both variables on `<html>` via
`className={`${display.variable} ${body.variable}`}`, then in CSS:
`--font-sans: var(--font-body), system-ui, sans-serif;` and
`--font-display-stack: var(--font-display), Georgia, serif;`

Display face for product names and page headings only. Body face everywhere else.
Use `font-variant-numeric: tabular-nums` on dates, prices, and counts.

### S7 — URL parameters (exact)

The feed reads filter state from search params. These names are the contract; Phase 2
will parse the same shape server-side.

| Param | Format | Example |
|---|---|---|
| `category` | comma-separated slugs | `?category=candy,snacks` |
| `country` | comma-separated codes | `&country=US,JP` |
| `status` | comma-separated values | `&status=new,limited_time` |
| `brand` | comma-separated slugs | `&brand=oreo,reeses` |
| `q` | raw string | `&q=pickle` |
| `sort` | `trending` only | `&sort=trending` |

Rules: omit a param entirely when unconstrained (never `?category=`). Omit `sort`
for the `newest` default. Unknown values are **ignored**, not an error. The cursor is
never in the URL — pagination is client state, so a shared link always opens at
page one.

### S8 — Component inventory and RSC boundaries

Getting this wrong is the most likely failure mode, so it is spelled out. Default to
Server Components; mark a file `'use client'` **only** where listed.

**Server Components** (no `'use client'`):
`app/layout.tsx` · `app/page.tsx` · `app/drops/[slug]/page.tsx` ·
`components/feed/FeedGrid.tsx` · `components/feed/FoodDropCard.tsx` ·
`components/drop/DropHero.tsx` · `components/drop/SourceList.tsx` ·
`components/drop/RetailerRow.tsx` · `components/drop/RelatedDrops.tsx` ·
all of `components/ui/` except `Sheet`

**Client Components** (`'use client'`, because they need state or browser APIs):
`components/feed/InfiniteScroller.tsx` (IntersectionObserver) ·
`components/filters/FilterSidebar.tsx` · `components/filters/FilterSheet.tsx` ·
`components/filters/CategoryChips.tsx` · `components/filters/SearchInput.tsx`
(debounce) · `components/filters/SortSelect.tsx` · `components/filters/ActivePills.tsx` ·
`components/ui/Sheet.tsx`

`app/page.tsx` renders page one on the server from `searchParams`. Further pages come
from a Server Action in `app/actions/feed.ts`:

```ts
'use server';
export async function loadMoreDrops(
  query: FeedQuery
): Promise<Page<FoodDropSummary>>;
```

`InfiniteScroller` is a client component that holds the accumulated items, calls the
action when its sentinel intersects, and appends. It must **de-duplicate by `id`**
before appending — that is the guard behind acceptance criterion 3.

The repository is obtained through `apps/web/lib/repository.ts`:

```ts
import { MockFoodDropRepository } from '@bitedrop/core/mock';
export const repository: FoodDropRepository = new MockFoodDropRepository();
```

Every component imports `repository` from there. **Nothing** outside that one file
may import from `@bitedrop/core/mock` — this is acceptance criterion 15, and it is
what makes Phase 2 a one-file change.

### S9 — The card

Layout, top to bottom:

1. Image, `aspect-ratio: 4/3`, `object-fit: cover`, `next/image` with `sizes` set.
   When `imageUrl === null`, render a `--surface-2` block with the category emoji
   centred at `--fs-3xl`. Never render a broken `<img>`.
2. Status badge, absolutely positioned top-left over the image. Add a second amber
   "Limited" badge only when `isLimitedTime && status !== 'limited_time'`.
3. Name — display face, `--fs-lg`, weight 700, max 2 lines (`line-clamp: 2`),
   prefixed by the category emoji.
4. Brand name — `--fs-sm`, `--text-2`. Omit the line entirely when `brand === null`.
5. `shortDescription` — `--fs-sm`, `--text-2`, max 2 lines.
6. Meta row — country flags (all of them), category name, and the best available date
   label. Date precedence: `availabilityStart` → `releaseDate` → omit. Format
   `"Available Sept 15"` / `"Releases Sept 15"`.
7. Retailer row — up to 3 names joined by ` · `, then `+N` when more. Omit the whole
   row when `retailers` is empty.
8. Footer row — `"{n} source{s}"` and `"Discovered {relative}"`, separated by ` · `.

The entire card is a single `<Link>` to `/drops/{slug}`. No nested interactive
elements. Fixed image aspect ratio plus `line-clamp` on both text blocks means cards
in a row have equal height and nothing shifts on image load.

### S10 — Formatting rules (`packages/core/src/format.ts`)

All pure functions, all with an injectable `now` where time is involved.

```ts
export function formatRelativeTime(iso: string, now: Date): string;
```

| Elapsed | Output |
|---|---|
| < 60 s | `just now` |
| < 60 min | `N minute ago` / `N minutes ago` |
| < 24 h | `N hour ago` / `N hours ago` |
| < 7 d | `N day ago` / `N days ago` |
| < 35 d | `N week ago` / `N weeks ago` |
| ≥ 35 d | `Mar 4, 2026` (absolute) |

Truncate, don't round: 119 minutes → `1 hour ago`. Future timestamps → `just now`.

```ts
export function formatPrice(cents: number, currency: string): string;  // 499,'USD' → '$4.99'
export function formatDropDate(iso: string, now: Date): string;        // '2026-09-15' → 'Sept 15'
export function formatSourceCount(n: number): string;                  // 1 → '1 source'
```

`formatDropDate` uses the abbreviations in the brief's mockup: `Jan Feb Mar Apr May
Jun Jul Aug Sept Oct Nov Dec` — note **`Sept`**, not `Sep`. Append the year only when
the date is not in the current year.

### S11 — Build order

Work in this order; each step leaves the app running.

1. **Scaffold** — workspaces, both packages, TS/ESLint/Prettier/Vitest, `npm run check` green on an empty repo.
2. **`packages/core`** — `reference.ts`, `schemas.ts`, `types.ts`, `repository.ts`, `format.ts` + its tests. No UI yet; `npm test` green.
3. **Mock data + repository** — `mock/data.ts` (40 drops), `mock/repository.ts`, coverage and pagination tests. `npm test` green.
4. **Tokens + `ui/` primitives** — `tokens.css`, fonts wired, `Badge` `Chip` `Card` `Skeleton` `Input` `Sheet`.
5. **Card + grid** — `FoodDropCard`, `FeedGrid`, static page one only. This is the first visually reviewable milestone.
6. **Infinite scroll** — Server Action, `InfiniteScroller`, skeletons, empty and error states.
7. **Filters + search** — sidebar, mobile sheet, chips, combobox, debounced search, sort, active pills, all URL-bound.
8. **Detail page** — `/drops/[slug]`, hero, source list, retailers, related, metadata/OG tags, `notFound()` on unknown slug.
9. **Polish** — header/footer, focus rings, keyboard pass, `prefers-reduced-motion`, Lighthouse run.

### S12 — Required tests

`packages/core/test/` — these specific cases, not a vague "add tests":

**`format.test.ts`** — each relative-time boundary (59 s, 60 s, 59 min, 60 min,
23 h, 24 h, 6 d, 7 d, 34 d, 35 d), singular vs plural at N=1, future timestamp,
price formatting incl. a whole-dollar amount, `formatDropDate` with and without year,
`Sept` abbreviation.

**`mock-data.test.ts`** — every coverage requirement in S5, asserted.

**`repository.test.ts`**
- Default `list` returns `PAGE_SIZE` items, newest first.
- Paging to the end: accumulated ids have **no duplicates and no gaps**, and the
  union equals the full filtered set.
- `nextCursor === null` exactly on the final page.
- A malformed cursor throws.
- Single-facet filters each narrow correctly.
- Two values in one facet behave as **OR**.
- Two different facets behave as **AND**.
- Search matches name, brand, and description; is case-insensitive; is
  diacritic-insensitive; empty string is treated as no filter.
- `sort: 'trending'` orders by `trendingScore` descending.
- Ties on the primary sort value are broken by `id` descending, deterministically.
- `getBySlug` returns `null` for an unknown slug, and `sources.length === sourceCount`.
- `facets()` counts sum correctly and are unaffected by any query.

### S13 — Do not do these things

1. Do not add a database, ORM, HTTP client, or network call of any kind.
2. Do not import from `@bitedrop/core/mock` anywhere except `apps/web/lib/repository.ts`.
3. Do not use `OFFSET`-style or page-number pagination, even though it is mock data.
4. Do not generate mock drops procedurally.
5. Do not use `Date.now()` in mock data or in any pure function — inject `now`.
6. Do not add a colour literal outside `tokens.css`.
7. Do not add a third font family, or an icon library. Emoji cover category and country.
8. Do not add state management (Redux, Zustand, Jotai). URL params plus local state suffice.
9. Do not add `any` or `@ts-ignore`.
10. Do not silently swallow errors to make something render — surface them.
11. Do not add auth, analytics, or a cookie banner.
12. Do not restructure the repository layout from `docs/03-local-dev.md`.

---

## Acceptance criteria

**Functional**

- [ ] 1 — `npm install && npm run dev` serves the feed with zero configuration and no database.
- [ ] 2 — Feed renders 40 mock drops, newest first, with every field from S9 present on each card.
- [ ] 3 — Infinite scroll pages to the end (12 / 12 / 12 / 4) with no duplicated or skipped items.
- [ ] 4 — Filters compose as OR within a facet and AND across facets, and survive reload and back-navigation via URL params.
- [ ] 5 — Search filters by name, brand, and description; case- and diacritic-insensitive.
- [ ] 6 — Sort toggles newest ↔ trending, reflected in `?sort=`.
- [ ] 7 — `/drops/[slug]` shows full detail, all sources with working outbound links, retailers, and related drops; unknown slug renders 404.
- [ ] 8 — Empty, loading (skeletons), and error states all render deliberately.

**Quality**

- [ ] 9 — Usable at 375 / 768 / 1280 / 1920 px: no horizontal overflow, no layout shift on image load, grid is 1 / 2 / 3 / 4 columns.
- [ ] 10 — Correct in all three theme states: `data-theme="dark"`, `data-theme="light"`, and no attribute.
- [ ] 11 — Keyboard-navigable end to end, visible focus, alt text on every image; Lighthouse accessibility ≥ 95.
- [ ] 12 — Lighthouse performance ≥ 90 on a production build of the feed page.

**Code**

- [ ] 13 — `npm run check` passes: `tsc --noEmit` strict, ESLint, Prettier.
- [ ] 14 — `npm test` passes with every case in S12 present.
- [ ] 15 — `grep -rn "core/mock" apps/web --include=*.tsx --include=*.ts` returns **only** `lib/repository.ts`.
- [ ] 16 — No `any`, no `@ts-ignore`, no colour literal outside `tokens.css`.

### Verification commands

```bash
npm run check
npm test
npm run build && npx next start -p 3000   # then run Lighthouse against :3000
grep -rn "core/mock" apps/web --include=*.ts --include=*.tsx   # expect 1 hit

# no file over 400 real lines outside the declared exemptions
git ls-files '*.ts' '*.tsx' | grep -v 'src/mock/' \
  | xargs -I{} sh -c 'n=$(grep -cvE "^\s*(//|$)" "{}"); [ "$n" -gt 400 ] && echo "$n {}"' \
  ; echo "(no lines above = within limit)"
grep -rnE "#[0-9a-fA-F]{3,8}\b" apps/web --include=*.tsx --include=*.css \
  | grep -v tokens.css        # review every hit; only non-colour uses are allowed
```

## Review notes

Worth a second opinion, specifically:

- **Does `FoodDropRepository` hold up against the real schema in `../02-data-model.md`?**
  A gap found here is cheap; found in Phase 2 it means touching the UI. Highest-value
  thing to scrutinise in the phase.
- **Criterion 15** decides whether Phase 2 is a swap or a rewrite. Check it by grep,
  not by trust.
- Does the card handle every missing-field combination the mock set contains?
- Is the S7 URL shape one a SQL `WHERE` clause can consume directly?
- Does it feel like the brief's "Pinterest for food drops" rather than an admin table?

---

## Outcome

*Not started. Filled in at completion.*

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
