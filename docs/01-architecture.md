# 01 — Architecture

## 1. The shape of the problem

BiteDrop is two systems that share one database:

1. **A read-heavy consumer web app.** Mostly static-ish content, needs to be fast
   and visual, traffic is bursty and cacheable.
2. **A write-heavy batch pipeline.** Runs on a schedule, talks to flaky third-party
   websites, does fuzzy matching, and is allowed to be slow.

These have almost nothing in common operationally. Coupling them is the main
architectural mistake available here, so the design keeps them as separate
deployable processes that communicate only through Postgres.

```
┌─────────────────────────────────────────────────────────────────┐
│  INGESTION (scheduled batch, runs hourly)                       │
│                                                                 │
│   sources ──▶ fetch ──▶ raw_item ──▶ filter ──▶ extract ──▶     │
│                          (append-only)                          │
│                              ──▶ dedupe ──▶ enrich ──▶ publish  │
└──────────────────────────────┬──────────────────────────────────┘
                               │  writes
                         ┌─────▼─────┐
                         │ Postgres  │   ← the only integration point
                         └─────▲─────┘
                               │  reads
┌──────────────────────────────┴──────────────────────────────────┐
│  WEB APP (Next.js)                                              │
│                                                                 │
│   feed · filters · search · detail pages · (later) BiteDrop AI   │
└─────────────────────────────────────────────────────────────────┘
```

The pipeline never calls the web app. The web app never triggers the pipeline.
Either can be redeployed, rewritten, or moved to a different host without
touching the other.

## 2. The three data layers

This is the most important idea in the schema, so it gets its own section.

| Layer | Tables | Mutability | Purpose |
|---|---|---|---|
| **Raw** | `source`, `fetch_run`, `raw_item` | Append-only | What we *observed*. Never edited by later stages. |
| **Canonical** | `food_drop`, `brand`, `category`, `food_drop_source`, … | Mutable | What we *believe*. The product's actual domain model. |
| **Derived** | `trending_score`, `ai_pick`, stats | Recomputable | What we *calculated*. Safe to drop and rebuild. |

Why it matters: extraction logic will be wrong at first. Because `raw_item` keeps
the original feed entry and the extracted text, **every FoodDrop can be rebuilt
from scratch when the extractor improves** — without re-crawling the web. That
single property is what makes it safe to ship a mediocre extractor in Phase 5 and
a good one in Phase 8.

## 3. Pipeline stages

Each stage is a pure-ish function over rows, with its own state on `raw_item.stage`.
Stages are separately runnable (`npm run ingest -- --stage=extract`), which makes
them separately testable and separately debuggable.

| # | Stage | Input → Output | Cost | Notes |
|---|---|---|---|---|
| 1 | **Fetch** | source → `raw_item` | network | Per-source isolation, timeouts, ETag/If-Modified-Since, retries with backoff |
| 2 | **Filter** | `raw_item` → `stage=candidate` \| `filtered_out` | ~free | Deterministic rules only. Kills recipes, reviews, listicles, old news |
| 3 | **Extract** | candidate → structured fields | free → LLM | Rules first (Phase 5), LLM for the hard residue (Phase 8) |
| 4 | **Normalize** | raw strings → canonical ids | free | Brand resolution, category mapping, date parsing, unit/price normalisation |
| 5 | **Dedupe** | candidate → new `food_drop` \| link to existing | free → LLM | Four deterministic layers, LLM only on ties |
| 6 | **Enrich** | `food_drop` → retailers, regions, images | free | Best-effort, never blocks publishing |
| 7 | **Publish** | `food_drop.published = true` | free | Editorial gate; confidence threshold |

**The filter stage is where quality is won.** The brief's "20 good drops beats
2,000 garbage articles" requirement is almost entirely a Stage-2 problem, and
Stage 2 costs nothing to run — so it can be iterated aggressively against a
fixture corpus without any API spend.

## 4. Deduplication design

The canonical-entity requirement is the product's differentiator, so dedupe is
designed as explicit ordered layers rather than one similarity score. Each layer
records *how* it matched on `food_drop_source.link_method`, which makes bad
merges auditable after the fact.

| Layer | Test | Confidence |
|---|---|---|
| 1 | Canonical URL already linked to a drop | certain |
| 2 | Content hash identical (syndicated copy) | certain |
| 3 | Same resolved brand **+** normalised product name equal | high |
| 4 | Same brand **+** trigram similarity > threshold **+** discovery within N days | medium |
| 5 | LLM adjudication on the surviving ambiguous pairs | low-medium |

Layers 1–4 are pure functions and get a dedicated test corpus in Phase 6.
Layer 5 is the only one that costs money, and it only ever sees pairs that
layers 1–4 could not settle.

Merges are reversible: a merged drop becomes a tombstone row (`merged_into_id`)
rather than being deleted, so permalinks keep working and a bad merge can be
undone.

## 5. LLM boundary

All model access goes through one interface, with no provider types leaking past it:

```ts
interface LlmProvider {
  extract<T>(opts: {
    schema: JsonSchema;        // structured output contract
    prompt: string;
    input: string;
    budget?: TokenBudget;
  }): Promise<Result<T, LlmError>>;
}
```

Three things this buys:

- **Phases 1–7 ship with zero LLM dependency.** A `RuleBasedProvider` satisfies the
  same interface, so the pipeline is complete and testable before any model is wired in.
- **Tests never call a network.** A `FixtureProvider` replays recorded JSON.
- **Provider choice stays a config decision,** not an architectural one.

Structured output is non-negotiable at this boundary — the pipeline consumes typed
JSON validated against a schema, never free text it has to parse.

## 6. BiteDrop AI — how the agent fits

The agent is deliberately *not* a separate system. It is a consumer of the same
data-access layer the web app uses, with each tool being a thin wrapper over a
repository method that already exists and is already tested.

```
  user message
      │
      ▼
  ┌────────────────────────────────────┐
  │ agent loop (plain TS, ~150 lines)  │
  │   while (stop_reason == tool_use)  │
  └──┬────────────────┬────────────────┘
     │ tool calls     │ streamed status + structured outcome
     ▼                ▼
  tool registry     SSE ──▶ browser
     │
     ▼
  packages/db repositories  ← same code the feed pages use
```

Two decisions worth flagging now, because they shape the schema:

**No orchestration framework initially.** The brief rightly says to adopt LangGraph
only if the workflow genuinely benefits. The one feature that usually justifies it
is interrupt/resume for human-in-the-loop — and that need is met by an `agent_run`
table holding `status` and a `state` JSONB blob. Pausing is `status =
'awaiting_approval'`; resuming is loading the row and continuing the loop. That is
a resumable workflow, durably persisted, in one table. A framework can be
introduced later if branching and retry semantics outgrow it, but it would be
adding a dependency to solve a problem we would not yet have.

**Tools are the permission boundary.** Read tools and write tools are registered
separately, so "the agent may search" and "the agent may modify my wishlist" are
independently grantable. This is what makes the Phase-D approval gate a
configuration change rather than a rewrite.

## 7. Technology choices

| Concern | Choice | Why this, and what it beats |
|---|---|---|
| Framework | **Next.js 16, App Router** | Server Components fit a read-heavy content feed exactly: filtering and pagination stay on the server, the client ships almost no data-fetching code. Brief-endorsed. |
| Language | **TypeScript, strict** | One language across web, pipeline, and agent; shared domain types are the thing that keeps the boundaries honest. |
| Database | **Postgres 17** | Brief-endorsed, and it does three jobs here that would otherwise need three services: relational store, full-text search (`tsvector`), and fuzzy matching (`pg_trgm`). |
| ORM | **Drizzle** | SQL-first and thin: migrations are reviewable `.sql` files, queries compile to SQL you can read. For a project whose explicit requirements include "avoid N+1" and "use indexes intentionally", being able to see the SQL matters more than DX sugar. **Alternative: Prisma** — better ergonomics, but a bespoke DSL, a heavier client, and more distance between your code and the query plan. |
| Styling | **Tailwind v4 + shadcn/ui primitives** | The UI is many variations of one card; utility classes keep that from sprawling. shadcn is copied-in source, not a dependency to fight. |
| Validation | **Zod** | One schema definition serves runtime validation, TS types, *and* the LLM's JSON Schema contract. |
| Tests | **Vitest** + **Playwright** | Vitest for the pure logic that matters (filtering, dedupe, normalisation); a handful of Playwright smoke tests, not a large E2E suite. |
| Monorepo | **npm workspaces** | Built into the Node we already have. No pnpm/Turborepo/Nx until there is a build-time problem to solve. |
| HTTP fetching | **undici** + **fast-xml-parser** + **cheerio** | Boring, maintained, no headless browser. A browser is the thing that makes scraping expensive and fragile; we avoid sources that require one. |

### Deliberate non-choices

- **No Redis.** Nothing yet needs a cache Postgres and HTTP caching cannot serve.
- **No message queue.** `raw_item.stage` *is* the work queue, transactionally consistent with the data. A queue becomes correct when stages need to scale independently; that is not now.
- **No external search service.** Postgres FTS until it measurably fails. The repository interface hides this, so swapping in Typesense/Meilisearch later touches one file.
- **No microservices.** Two processes and a database.
- **No auth until Phase 11.** The feed is public; accounts only become necessary when wishlists arrive.

## 8. Scaling path

Honest assessment of what breaks first, and what the fix is — none of which require a rewrite:

| Limit hit | Symptom | Fix |
|---|---|---|
| Neon free 0.5 GB | DB full | Prune `fetch_run`; move `raw_item.body_text` to R2 (keyed by hash) |
| ~50+ sources | Hourly run exceeds runtime | Shard by source across parallel jobs — already per-source isolated |
| Postgres FTS quality | Poor search relevance | Swap the search repository for Typesense/Meilisearch |
| Read traffic | Slow feed | The feed is cacheable: ISR + `Cache-Control`; add a read replica |
| Vercel Hobby limits | Usage caps | Move web to Cloudflare/Fly/a VPS — see §9 for the one piece that needs real work |
| Many concurrent app instances | Postgres connection exhaustion | Put a pooler (Neon's built-in pooler, or PgBouncer) in front of `DATABASE_URL` |

The one structural commitment is Postgres. Everything else is behind an adapter.

**The web tier is already stateless and horizontally scalable, at no extra cost.**
`apps/web` holds no state between requests — no session store, no in-process cache
whose correctness depends on being the same instance across requests, nothing one
running copy would need to know that another doesn't. Every request reads fresh from
Postgres, which is the only shared state. That property falls directly out of two
decisions above ("No Redis", ingestion kept entirely out of the web app) — it was not
built separately and isn't something to revisit later. Run one instance or many, they
all just query the same database and agree.

That said, "many instances" means different things depending on where this is
deployed: on Vercel (the current target) there is no replica count to set — functions
autoscale per-request automatically. "Pods" or "replicas" as a literal knob only
applies once/if this moves to a container host (Fly, a VPS, k8s), and the stateless
property above is exactly what makes that move safe when it happens. Either way, the
thing that stops scaling for free past a point is Postgres itself, not the app — see
the connection-pooling row above, and note it gets more pressing as concurrency grows,
not less.

**Caching is deferred, not designed away.** Nothing here caches yet — deliberately,
so Phase 2's query-cost work stays honest rather than getting masked. When it's
needed, it plugs in at one of two points without touching the UI: HTTP/CDN caching
(`Cache-Control`/ISR) on the feed route for anonymous traffic, or a caching
implementation of `FoodDropRepository` wrapping `PgFoodDropRepository`, the same
seam the mock→Postgres swap in Phase 2 used. One caveat worth flagging now rather
than at cache-implementation time: Phase 11 adds auth and per-user wishlists, and a
personalised response can't sit behind a blanket cache the way an anonymous feed
can — that's a real design conversation for whenever caching and personalisation
land in the same phase window, not a solved problem today.

## 9. Portability — what is and isn't coupled

Nothing in the design is *structurally* tied to a vendor, but lock-in creeps in
through dependency choices rather than architecture. This section is the guard.

| Component | Coupled to | Moving it |
|---|---|---|
| `apps/ingest` | Nothing. Plain Node + Postgres URL | Run it anywhere cron exists. **Zero work** |
| `packages/core` | Nothing. Pure functions | N/A |
| `packages/db` | Postgres the protocol, not the host | Change `DATABASE_URL`. **Zero work** |
| Database | Standard Postgres | `pg_dump` → restore on RDS/Fly/Supabase/a box. Hours |
| Scheduler | GitHub Actions YAML | Any cron, Worker trigger, or systemd timer. Minutes |
| `apps/web` | Next.js, not Vercel | `next build && next start` on any Node host — **except image optimisation, below** |

### The one piece that needs real work

**`next/image` optimisation is the only genuine soft spot.** On Vercel it is
automatic; self-hosted it needs `sharp` installed and a cache directory, and on
Cloudflare it needs a custom loader. Everything else in the web app is stock Next.js
that `next start` serves anywhere.

This is a known, bounded cost — a day, not a rewrite — and it gets smaller in Phase 9
when images move to R2 and can be served pre-sized.

### Rules that keep it this way

These are easy to violate silently, which is why they are written down:

1. **Use a standard Postgres driver** — `postgres.js` or `node-postgres`. Do **not**
   use `@neondatabase/serverless`: it is a Neon-specific HTTP/WebSocket driver and
   adopting it couples every query path to Neon. The standard driver over TCP works on
   Neon and everywhere else.
2. **No `@vercel/*` runtime packages.** No Vercel KV, Blob, Edge Config, or Postgres
   wrapper. If something needs key-value storage, it goes in Postgres.
3. **Talk to R2 over the S3-compatible API** (Phase 9), not a Cloudflare-specific SDK.
   R2, S3, B2, and Minio then become a config change.
4. **Workers AI stays behind `LlmProvider`** (Phase 8) — one implementation file, never
   imported directly by the pipeline.
5. **No platform-specific primitives in app code** — no Durable Objects, no Cloudflare
   bindings, no Vercel middleware tricks. If a platform feature looks necessary, that
   is a design discussion first.
6. **Keep ingestion out of the web app.** It is the highest-risk, most platform-hostile
   code in the project; as a standalone CLI it can always be moved somewhere with no
   limits.

### What we are genuinely betting on

**Postgres, and TypeScript.** Both are deliberate, and neither is a vendor.
Everything else — host, scheduler, object store, model provider, search engine — sits
behind an interface or a connection string.
