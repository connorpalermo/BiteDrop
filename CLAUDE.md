# BiteDrop — Development Guide

A discovery feed for new, unusual, and limited-time food releases worldwide.
The differentiator is the **canonical FoodDrop**: ten outlets reporting one new
Oreo flavour produce *one* drop with ten sources attached.

**Current status:** planning complete, no application code. Next up is Phase 1.
Keep this line current as phases land.

Full design docs live in [`docs/`](./docs). This file carries only what changes
how we work — read the docs for detail, not this file.

---

## Development Workflow

- Work incrementally.
- **Do not implement multiple phases without approval.** One phase, then stop for review.
- Before major architectural changes, explain the options and tradeoffs first.
- Report outcomes honestly. If tests fail, show the output. If something was skipped, say so.

### Phase documentation

Every phase gets one record in [`docs/phases/`](./docs/phases), committed alongside
the phase it describes. Copy `docs/phases/_TEMPLATE.md` to start one.

1. **Before starting** — write the Plan and Acceptance criteria halves, then get
   review *before* writing code.
2. **At completion** — fill in the Outcome half (what changed · how to run it · how
   to test it · known limitations · decisions made during implementation ·
   recommended next step) and tick the criteria.
3. **Then** — update the status table in `docs/phases/README.md` and the status line
   at the top of this file. Stop for review before the next phase.

Phase work is left in the working tree for the repo owner to commit — see
`~/.claude/CLAUDE.md` for the git policy.

The **decisions made during implementation** section is the one that matters most:
the plan records what we intended, that section records what we learned, and the gap
between them is the useful information.

## Engineering

- Prefer simple solutions over clever abstractions.
- Do not introduce microservices unless there is a concrete reason.
- Keep domain logic separate from framework and infrastructure concerns.
- Avoid premature optimization.
- Favour explicit, readable code.
- Design for idempotency and retries where appropriate.
- Validate external data at system boundaries.

## AI Development

- **Do not use an LLM where deterministic logic is sufficient.**
- Keep agent tools narrowly scoped and strongly typed.
- Prefer structured outputs.
- Never allow an agent to mutate state through an implicit mechanism.
- Separate read-only tools from state-changing tools.
- Make important agent actions observable and testable.

## Quality

- Write tests for meaningful business logic.
- Run tests, typechecking, and linting after significant changes.
- Review your own implementation for edge cases before declaring a phase complete.
- **Do not hide errors simply to make tests pass.**

---

## Architecture — settled decisions

These are decided. Revisit only with a concrete reason, and say so explicitly.

| Decision | Choice | Rationale |
|---|---|---|
| Shape | Modular monolith + separate batch CLI | Ingestion and serving share **only** Postgres |
| Web host | Vercel Hobby | Workers free caps CPU at 10 ms/request — too tight for React SSR |
| Database | Neon (free) | Supabase free pauses after 7 idle days needing a *manual* unpause |
| Ingestion runtime | GitHub Actions cron, plain Node CLI | Identical code path locally and in production |
| Framework | Next.js 16, App Router, RSC | Read-heavy content feed; filtering stays server-side |
| ORM | Drizzle | Reviewable `.sql` migrations; the emitted SQL is legible |
| Search | Postgres FTS + `pg_trgm` | No external service until it measurably fails |
| First LLM use | **Phase 8**, not earlier | Prove the whole path with deterministic rules first, at $0 |
| Agent orchestration | Plain loop + `agent_run` table | Interrupt/resume is a status column, not a framework |
| Images | Hotlink now, mirror to R2 in Phase 9 | Decided 2026-09-11; `image_stored_key` column already reserved |

Everything runs at **$0**. Do not introduce paid infrastructure without explicit approval.

### The two-system split

```
ingestion (hourly batch CLI) ──writes──▶ Postgres ◀──reads── Next.js web app
```

The pipeline never calls the web app. The web app never triggers the pipeline.
Postgres is the only integration point.

### The three data layers

| Layer | Tables | Rule |
|---|---|---|
| Raw | `source`, `fetch_run`, `raw_item` | **Append-only.** Never edited by later stages |
| Canonical | `food_drop`, `brand`, `food_drop_source`, … | Mutable — what we believe |
| Derived | `trending_score`, `ai_pick` | Recomputable. Safe to drop and rebuild |

Because the raw layer is preserved, **every FoodDrop can be rebuilt when the
extractor improves** — with no re-crawling. Protect this property.

---

## Non-negotiable invariants

Easy to violate by accident; each one has a real cost.

1. **No SQL outside `packages/db/repositories/`.** One place to audit for N+1s
   and missing indexes. The web app and the agent both consume repositories.
2. **No component imports mock or raw data directly** — everything goes through
   `FoodDropRepository`. This is what keeps the data layer swappable.
3. **Keyset pagination, never `OFFSET`.** Cursor is `(first_seen_at, id)`,
   opaque and base64-encoded. `OFFSET` double-renders items when new drops land
   mid-scroll.
4. **`packages/core` has no I/O.** Filter rules, dedupe matching, normalisation,
   and trending are pure functions over plain data. That is what makes them testable.
5. **Never store raw HTML.** `raw_item.body_text` is extracted text capped at
   40k chars. The database ceiling is 0.5 GB and this is what would consume it.
6. **Every index exists for a named query.** Filter composites end in the sort key
   so filter-plus-sort is one index scan. Don't add an index without naming its query.
7. **Per-source failure isolation.** A thrown adapter error records a failed
   `fetch_run` and the loop continues. One dead site must never fail the run.
8. **Ingestion is idempotent.** `UNIQUE (source_id, url_hash)` +
   `ON CONFLICT DO NOTHING`. Re-running a fetch must create nothing new.
9. **Nothing deletes a `food_drop`.** Status moves to `discontinued`; merges
   tombstone via `merged_into_id`. Historical data is a product goal.
10. **New drops default to `published = false`.** Publishing is a separate
    decision above a confidence threshold — so an extraction bug is not
    immediately user-visible.
11. **Trending is computed at write time** into an indexed column, never at read
    time. A feed sorting by a computed expression cannot use an index.
12. **When uncertain about a drop, use `status = 'rumored'` and low
    `confidence`** — never present an unconfirmed release as fact.

---

## Repository layout

```
apps/
  web/        Next.js — the consumer app
  ingest/     Node CLI — stages/ fetch·filter·extract·dedupe·enrich·publish
packages/
  core/       domain types + PURE logic, no I/O, heavily tested
  db/         Drizzle schema · migrations/ · repositories/  ← all SQL lives here
  sources/    adapters/ rss · json-api · html-listing · reddit
  llm/        LlmProvider + providers/ rule-based · fixture · cloud    (Phase 8)
  agent/      tools/ + the loop                                       (Phase 12+)
docs/         design docs — the canonical record
```

Adding a data source = one row in `source`, plus an adapter file **only** if it
needs a new `type`.

## Commands

```bash
npm run dev          # compose up → wait healthy → migrate → seed → next dev
npm run db:reset     # drop · recreate · migrate · seed
npm run db:generate  # Drizzle: schema diff → new .sql migration
npm run ingest -- --source=<slug> --dry-run
npm run ingest -- --stage=filter      # re-run one stage over existing rows
npm test             # Vitest unit + integration (real Postgres, not mocks)
npm run check        # typecheck + lint + format
```

Docker runs **Postgres only** — Node runs natively on the host.

## Testing

- **Unit** (Vitest) — `packages/core`. No I/O, no mocks.
- **Fixtures** — adapters parse *recorded* payloads committed to the repo. No network in tests.
- **Integration** — repositories against a real `bitedrop_test` database. No mocked database: it tests the mock, and every interesting bug here is a constraint or query-plan bug.
- **E2E** (Playwright) — a few smoke paths only.

## Code style

- TypeScript strict. No `any`, no `@ts-ignore`.
- Zod schemas are the single source of truth; infer TS types from them.
- No hardcoded colours outside `tokens.css`.
- Config validated with Zod at startup — fail fast and loudly on a bad deploy.
- Secrets in env vars only, never committed. `.env.example` stays current.

---

## Known watch items

- **0.5 GB database ceiling.** Mitigations in order: cap `body_text` (P4), prune
  `fetch_run` past 30 days (P7), offload body text to R2 (later).
- **GitHub Actions disables scheduled workflows after 60 days with no commits.**
  Harmless during active development.
- **Social (TikTok/Instagram) is out of scope** until P16+. No free API path,
  hostile to scraping, least unique signal. Reddit OAuth in P10 covers the need.
