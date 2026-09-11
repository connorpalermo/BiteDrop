# 05 — Ingestion Sources

Every feed below was probed on **2026-09-11**. The results changed the plan, so the
failures are recorded alongside the successes.

## Verified working — free, plain HTTP, no credentials

| # | Source | Feed | Trust | Precision | Value |
|---|---|---|---|---|---|
| 1 | **Brand Eating** | `brandeating.com/feeds/posts/default?alt=rss` | 2 | **High** | Dedicated to new fast-food and packaged-snack items. The single best-fit source for this product. |
| 2 | **PR Newswire — Food & Beverage** | `prnewswire.com/rss/food-beverage-latest-news/food-beverage-latest-news-list.rss` | **1** | **High** | Official brand press releases. This is how we get first-party announcements without scraping brand sites. |
| 3 | **The Takeout** | `thetakeout.com/rss` | 2 | Medium | Strong new-release coverage mixed with commentary. |
| 4 | **Foodbeast** | `foodbeast.com/feed/` | 2 | Medium | Novelty and limited-edition focus; good fit for the "unusual" angle. |
| 5 | **Delish — Food News** | `delish.com/rss/food-news.xml/` | 2 | Medium-low | Decent new-product coverage, heavy recipe noise. |
| 6 | **Eater** | `eater.com/rss/index.xml` | 2 | Low | Restaurant-led, mostly openings and reviews. Include last, if at all. |

All six returned HTTP 200 with valid XML.

## Probed and rejected

| Candidate | Result | Implication |
|---|---|---|
| Reddit JSON (`/r/X/new.json`) | **403** | Needs a registered OAuth app. Free, but credentials + rate limits — defer to Phase 10. |
| Chewboom | `/feed/` serves **HTML, not RSS** | Good content, needs an HTML-listing adapter. Not the RSS freebie I expected. |
| Business Wire food RSS | **403** | Bot-blocked. PR Newswire already covers this role. |
| Serious Eats, Allrecipes | **403** | Dotdash Meredith properties block non-browser clients. |
| Thrillist, Candy Hunting, Snack Gator | **404** / unreachable | Feed paths dead or site gone. |
| McDonald's / Taco Bell newsrooms | No RSS; SPA-rendered HTML | Per-brand adapters, each one bespoke and fragile. |

### The finding that changed the plan

I expected to lead with **brand-official newsrooms as tier-1 sources**. They are not
viable cheaply — major brands have stopped publishing RSS and now serve
JavaScript-rendered newsrooms that need a headless browser, which is precisely the
expensive, fragile scraping the brief rules out.

**PR Newswire's food RSS solves this.** Brands publish launch announcements through the
wire services, so a single free feed delivers first-party announcements from many brands
at once. That makes it the highest-value source after Brand Eating, and it means the
`trust_tier = 1` tier is reachable in Phase 4 rather than being deferred indefinitely.

## Phase plan

- **Phase 4 (first adapters):** sources 1 and 2 only — the two highest-precision feeds.
  Two sources is enough to prove the adapter abstraction; it is also enough to start
  exercising dedupe, since Brand Eating and PR Newswire will cover the same launches.
- **Phase 6 (dedupe):** add 3 and 4, which guarantees overlapping coverage of the same
  products — the condition dedupe needs to be tested against.
- **Phase 10 (expansion):** 5 and 6, the HTML-listing adapter for Chewboom, Reddit via
  OAuth, and YouTube channel feeds (`youtube.com/feeds/videos.xml?channel_id=…` is free
  and key-less, but needs real channel IDs looked up).

## Adapter interface

```ts
interface SourceAdapter {
  readonly type: SourceType;
  fetch(source: Source, ctx: FetchContext): Promise<FetchResult>;
}

interface FetchContext {
  etag?: string;
  lastModified?: string;
  timeoutMs: number;
  logger: Logger;
}

interface FetchResult {
  items: DiscoveredItem[];      // pre-normalisation
  etag?: string;
  lastModified?: string;
  notModified: boolean;         // 304 → skip the rest of the pipeline
}
```

Adding a source is: one row in `source`, and — only if it needs a new *type* — one file
in `packages/sources/src/adapters/`. The six verified feeds above all share a single
`rss` adapter, differing only in `config`.

## Operating rules

These are engineering requirements, not politeness:

- Honour `robots.txt`; identify as `BiteDropBot/0.1 (+<url>)`.
- Conditional GET (`If-None-Match` / `If-Modified-Since`) on every fetch — cheap for us,
  cheap for them, and `304` responses skip the pipeline entirely.
- One request per source per run, 10 s timeout, max 2 retries with exponential backoff.
- **Per-source failure isolation:** every adapter call is wrapped; a thrown error records
  a `fetch_run` with `status='error'` and the loop continues. One dead site cannot fail
  the run.
- Auto-disable a source after N consecutive failures, surfaced on the admin health page
  rather than silently retrying forever.
- Store links and short excerpts, never full article text for redistribution — every
  FoodDrop links back to its sources, which is both the brief's verifiability requirement
  and the right relationship with publishers.
