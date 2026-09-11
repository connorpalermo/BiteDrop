# 03 — Local Development

## Principle

Docker for **stateful infrastructure only**. Node runs on the host.

Containerising the Next.js dev server is a common reflex and a bad trade on macOS:
bind-mount filesystem performance makes HMR noticeably slower, and it buys no
reproducibility that `.nvmrc` plus a lockfile does not already provide. Postgres
is the opposite case — version and extension drift between a Homebrew install and
production is a real source of "works on my machine", and a container removes it.

So: one container, one `docker compose up`, everything else native.

## Repository layout

```
BiteDrop/
├── apps/
│   ├── web/                    # Next.js 16 — the consumer app
│   │   ├── app/
│   │   │   ├── (feed)/page.tsx
│   │   │   ├── drops/[slug]/page.tsx
│   │   │   ├── api/
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   └── lib/
│   └── ingest/                 # Node CLI — the pipeline runner
│       ├── src/
│       │   ├── cli.ts
│       │   └── stages/         # fetch · filter · extract · dedupe · enrich · publish
│       └── test/
├── packages/
│   ├── core/                   # domain types + pure logic (no I/O, heavily tested)
│   │   ├── src/
│   │   │   ├── types.ts        # FoodDrop, Brand, Source, …
│   │   │   ├── schemas.ts      # Zod schemas → TS types → LLM JSON Schema
│   │   │   ├── normalize.ts    # name/brand/date/price normalisation
│   │   │   ├── filter.ts       # deterministic relevance rules
│   │   │   ├── dedupe.ts       # matching layers 1–4
│   │   │   └── trending.ts     # scoring formula
│   │   └── test/
│   ├── db/                     # Drizzle schema, migrations, repositories
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   ├── repositories/   # the ONLY place SQL lives
│   │   │   └── seed/
│   │   └── migrations/         # generated .sql, committed, reviewable
│   ├── sources/                # source adapters + registry
│   │   └── src/adapters/       # rss.ts, json-api.ts, html-listing.ts, reddit.ts
│   ├── llm/                    # LlmProvider abstraction (Phase 8)
│   │   └── src/providers/      # rule-based.ts, fixture.ts, <cloud>.ts
│   └── agent/                  # BiteDrop AI: tools + loop (Phase 12+)
│       └── src/tools/
├── docs/
├── docker-compose.yml
├── .env.example
├── .nvmrc
├── package.json                # npm workspaces root
└── tsconfig.base.json
```

### Why these boundaries

- **`packages/core` has no I/O.** Filtering, dedupe matching, normalisation, and
  trending are pure functions over plain data. That is what makes the
  business-logic tests the brief asks for fast, deterministic, and worth writing.
- **`packages/db` owns all SQL.** One place to audit for N+1s and missing indexes.
  Both the web app and the agent consume repositories, never raw queries.
- **`apps/ingest` is a CLI, not an HTTP endpoint.** A pipeline run takes longer than
  a serverless request limit allows, needs to be runnable locally against a single
  source, and should not be publicly reachable.
- **`packages/sources` is separate from `apps/ingest`** so adding a source is adding
  one file that implements one interface — which is the brief's extensibility
  requirement made literal.

## Compose file

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: bitedrop-postgres
    environment:
      POSTGRES_USER: bitedrop
      POSTGRES_PASSWORD: bitedrop
      POSTGRES_DB: bitedrop
    ports: ["5433:5432"]          # 5433 avoids colliding with a host Postgres
    volumes:
      - bitedrop-pgdata:/var/lib/postgresql/data
      - ./packages/db/init:/docker-entrypoint-initdb.d:ro   # CREATE EXTENSION …
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bitedrop -d bitedrop"]
      interval: 3s
      timeout: 3s
      retries: 20

volumes:
  bitedrop-pgdata:
```

That is the entire infrastructure. No app container, no Redis, no pgAdmin —
Drizzle Studio covers browsing, and an extra service is an extra thing to break.

## Commands

```bash
nvm use && npm install        # once
cp .env.example .env.local    # once

npm run dev                   # compose up → wait healthy → migrate → seed → next dev
npm run dev:db                # Postgres only
npm run db:migrate            # apply migrations
npm run db:generate           # Drizzle: schema diff → new .sql migration
npm run db:seed               # deterministic sample data
npm run db:reset              # drop, recreate, migrate, seed
npm run db:studio             # Drizzle Studio

npm run ingest                        # full pipeline, all enabled sources
npm run ingest -- --source=brandeating-rss --dry-run
npm run ingest -- --stage=filter      # re-run one stage over existing raw_items

npm test                      # Vitest unit + integration
npm run test:e2e              # Playwright smoke
npm run check                 # typecheck + lint + format
```

`npm run dev` being a single command that produces a working seeded app is the
thing worth protecting — it is what makes the repo easy to pick up after a month away.

## Testing strategy

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | `packages/core` — filter rules, dedupe layers, normalisation, trending. No I/O, no mocks. |
| Fixtures | Vitest | Source adapters parse **recorded** feed payloads committed to the repo. No network in CI. |
| Integration | Vitest + Docker PG | Repositories against a real `bitedrop_test` database, truncated between tests. Catches the things mocks hide: constraints, index usage, transaction behaviour. |
| E2E | Playwright | A handful of smoke paths — feed loads, filter applies, detail page renders. |

Two deliberate positions: **no mocked database** (it tests the mock, and every
interesting bug here is a constraint or query-plan bug), and **no network in tests**
(recorded fixtures make adapter tests deterministic and let the dedupe corpus grow
into a regression suite).

## Environment variables

```bash
# .env.example
DATABASE_URL=postgresql://bitedrop:bitedrop@localhost:5433/bitedrop
NODE_ENV=development
LOG_LEVEL=debug

# Phase 8+
LLM_PROVIDER=rule-based           # rule-based | fixture | <cloud>
LLM_API_KEY=

# Phase 4+, optional
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
```

Loaded via a Zod-validated config module that fails fast at startup on anything
missing or malformed — a misconfigured deploy should die immediately and loudly,
not at 3am when the first request touches the variable.
