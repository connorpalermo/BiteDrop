# 08 — Feedback on the Brief

The brief is unusually well-specified, and most of it I would not change. What follows
is the set of things I think should be changed, added, or deferred, with reasoning.

## Recommended changes

### 1. Split "extraction" into rule-based then LLM — and put rules first
**Brief:** Phase 4 introduces structured extraction.
**Proposal:** Phase 5 = deterministic rule-based extraction; Phase 8 = LLM extraction.

An LLM available early is a way to avoid writing a good deterministic filter, and filter
quality is where the brief's "20 good drops beats 2,000 garbage articles" bar is actually
won. Doing rules first also produces the labelled corpus that makes "the LLM extractor is
better" a measurement rather than an impression — and it means Phases 1–7 are a complete,
working, $0 product even if the free model turns out to be too weak.

### 2. Deploy at Phase 3, not after ingestion works
**Brief:** deployment is implied late.
**Proposal:** deploy right after the database lands.

Infrastructure problems are cheapest to debug when the app is two pages. Deferring the
first deploy means debugging deployment and ingestion simultaneously, and one will mask
the other.

### 3. Use Neon instead of Supabase
**Brief:** "Supabase free tier or another genuinely free PostgreSQL option."

Supabase free **pauses after 7 days of inactivity and requires a manual dashboard
unpause**. That interacts badly with the rest of the design: hourly ingestion is what
keeps the database awake, so any pause in the cron cascades into a paused database and a
dead site. Neon scales to zero and auto-resumes, which removes the failure mode. We also
use none of Supabase's differentiators — auth in Phase 11 is Auth.js on plain Postgres.
Full comparison in [`04-deployment.md`](./04-deployment.md).

### 4. Do not host the Next.js app on Cloudflare Workers free
**Brief:** "Cloudflare for hosting/serverless infrastructure where appropriate."

The Workers free plan caps CPU at **10 ms per request**, which React SSR of a feed page
can plausibly exceed — and the failure mode is requests erroring under load. Lifting it
means the paid plan, which the brief rules out. Recommend Vercel Hobby for the app and
Cloudflare for what it is genuinely best at here: R2 for image mirroring (Phase 9) and
Workers AI for free inference (Phase 8). No app code is host-specific, so this is
reversible.

### 5. Run ingestion on GitHub Actions, not a serverless cron
The pipeline wants a full Node runtime, minutes rather than milliseconds, and — most
valuable of all — **the identical code path locally and in production**. `npm run ingest`
debugging on a laptop is worth more than edge proximity for a job that runs hourly and
faces no users. Ingestion stays a plain CLI, so the scheduler is swappable later.

### 6. Add a `published` flag to `food_drop`
Not in the brief. The pipeline should be able to create a low-confidence drop *without*
it appearing publicly, with publishing as a separate decision (automatic above a
confidence threshold, manual below).

This is the cheapest possible insurance for the content-quality requirement. Without it,
every extraction bug is immediately user-visible and the only remedy is deleting rows —
which conflicts with the historical-data goal.

### 7. Keep `subcategory` as free text initially
The brief lists subcategory as a field. A subcategory *table* requires knowing the
taxonomy, and that is not knowable until a few thousand real drops exist. Free text now,
promote to a table once the actual distribution is visible. Guessing wrong and migrating
is strictly worse than deferring.

### 8. Hold off on an orchestration framework for the agent
The brief already says to adopt LangGraph only if the workflow benefits — agreed, and
I think the answer will be no for a long time. The feature that usually justifies it is
interrupt/resume, and that is met by an `agent_run` row holding `status` and a `state`
JSONB blob: pausing is a status change, resuming is loading the row. A durable resumable
workflow in one table, with no dependency and nothing hidden.

### 9. Treat `fetch_run` as the observability product
The brief asks for per-source health fields, which the schema has. Worth making explicit:
the reliability requirement is satisfied by `fetch_run` + `source` health columns + a
small `/admin/health` page, with **no observability vendor at any phase**. Structured
JSON logs to stdout cover the rest.

## Things to defer further than the brief suggests

### Social discovery (TikTok / Instagram)
The brief already treats these as optional. I would go further: **out of scope entirely**
until Phase 16+. Neither has a free API path for this use case, both are actively hostile
to scraping, and any implementation would be the most fragile code in the repo while
adding the least unique signal — food launches reach RSS and the wire services anyway.
Reddit via its free OAuth tier (Phase 10) covers the "social signal" need at a fraction
of the cost.

### Retailer availability
The brief says keep it simple in v1 — agreed, and the schema supports it from Phase 2
while population waits until Phase 9. Rows appear only when a source explicitly states
availability, with `evidence_raw_item_id` recording which one. No retailer integrations,
no inventory APIs, no guessing.

### Trending
Deterministic formula computed by the hourly job into an indexed column. Five tunable
constants, explainable, no ML. Also: compute it at write time, not read time — a feed
that sorts by a computed expression cannot use an index.

## Resolved: image hosting

**Decided 2026-09-11 — hotlink now, mirror later.**

Images are the one part of the $0 plan with no clean free answer, because BiteDrop does
not produce any of them: every card photo comes from an ingested article, so something
has to decide where the bytes the browser loads come from.

- **Phases 1–8 — hotlink.** Store the source URL and let the browser fetch it via
  `next/image` with an explicit `remotePatterns` allowlist. Costs nothing and unblocks
  the UI immediately.
- **Phase 9 — mirror to R2.** Download each image once during ingestion into Cloudflare
  R2 (10 GB free, no egress fees) and serve from there. The `image_stored_key` column
  already exists, so this needs no migration.

The reason it cannot stay hotlinked forever is the historical-data goal rather than
aesthetics: a 2026 drop whose publisher-hosted image 404s in 2029 is a broken row in the
archive the brief exists to build. Link rot is effectively guaranteed on that timespan,
which makes it a data-quality problem. Hotlinking also depends on other people's
hosting (they can move, delete, or referrer-block the file) and consumes Vercel's
image-optimisation quota.

## Things in the brief I specifically want to endorse

- **The canonical FoodDrop with multiple sources** is the right differentiator, and it is
  the decision that most shapes the schema. Worth the dedupe complexity it costs.
- **"Don't send every scraped article to an LLM"** — correct, and the reason the pipeline
  has a free deterministic filter stage ahead of everything expensive.
- **Keeping raw source data for reprocessing** — this is the single most valuable
  architectural instruction in the brief. It makes a wrong extractor a recoverable
  mistake instead of a permanent data-quality loss.
- **`confidence` + a `rumored` status** — exactly the right mechanism for "mark something
  as unconfirmed rather than presenting it as fact."
- **Historical data as a first-class goal** — it changes the schema meaningfully
  (tombstones instead of deletes, dated availability windows) and it is where the
  product's long-term value sits.
- **Vertical slices with review gates** — the reason this plan has 16 small phases rather
  than 9 larger ones.
