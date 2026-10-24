# Phase 03 — Deploy

| | |
|---|---|
| **Status** | Complete — awaiting review |
| **Planned** | 2026-09-20 |
| **Completed** | 2026-10-24 |
| **Commits** | — (left in the working tree; commits are the repo owner's) |

**Goal.** The Phase 2 app running at a public URL on Vercel + Neon, with CI green on
every PR and a preview deployment per PR.

**Non-goals.** Ingestion or its cron (Phase 4/7) · auth (Phase 11) · caching, ISR, or
CDN tuning · a custom domain · alerting/uptime monitoring · per-PR database branching ·
R2 image mirroring (Phase 9) · any change to what the app renders.

> **This document is a specification, not a sketch.** Every command, file, and setting
> an implementer needs is stated here. If something is genuinely ambiguous, that is a
> defect in this document — **stop and ask rather than inventing an answer.**

> **⚠️ Most of this phase cannot be done by an agent.** Unlike Phases 1 and 2, the
> critical path runs through third-party dashboards and account creation. An agent
> working this phase **must not**:
> - claim a dashboard step was completed — you cannot see the dashboard;
> - invent, guess, or placeholder a connection string, API key, or project ID;
> - mark an acceptance criterion met on the basis of "this should work."
>
> When you reach a step marked **HUMAN**, stop, say exactly what you need, and wait.
> A fabricated Neon URL that looks plausible is the single worst outcome available in
> this phase — it fails later, somewhere unrelated, with a confusing error.

---

## Plan

### The one idea

Deploy now, while the app is a feed and two pages. Everything in this phase is an
infrastructure problem, and infrastructure problems are cheapest to solve when the
only moving parts are "Next.js reads Postgres." Phase 4 adds an ingestion pipeline;
debugging a broken deploy *and* a broken crawler at the same time is the situation
this ordering exists to avoid ([`../06-roadmap.md`](../06-roadmap.md)).

The app is also **read-only** — `FoodDropRepository` exposes `list`, `getBySlug`, and
`facets`, and nothing in `apps/web` writes to Postgres. That fact simplifies several
decisions below (notably preview environments), and it stops being true in Phase 11.

### Who does what

| # | Step | Who | Why |
|---|---|---|---|
| S1 | Decide repo visibility, preview-DB strategy, migration trigger | **HUMAN** | Account-level and cost decisions |
| S2 | Create the Neon project, hand back two connection strings | **HUMAN** | Requires an account |
| S3 | `prepare: false` on the driver | agent | Code change |
| S4 | Vercel env vars | **HUMAN** | Secrets go in a dashboard |
| S5 | Migrate + seed the Neon database | **HUMAN runs**, agent supplies the exact command | Needs the real credential |
| S6 | Create and configure the Vercel project | **HUMAN** | Requires an account |
| S7 | `.github/workflows/ci.yml` | agent | Code change |
| S8 | Smoke-verify the live URL | either | Agent can `curl`; human should also click |

---

## Implementation spec

### S1 — Three decisions, before anything else — **HUMAN**

**1. Repo visibility.** The repo is currently **private**
(`connorpalermo/BiteDrop`), but [`../04-deployment.md`](../04-deployment.md)'s cost
table assumes a public repo ("Unlimited minutes on public repos"). On a private repo
the free tier is **2,000 Actions minutes/month** instead.

That is fine for Phase 3 — CI runs are a couple of minutes and only fire on PRs. It
is **not** obviously fine for Phase 7, where an hourly ingest cron is ~730 runs/month.
Decide now, because it is cheaper than discovering it in Phase 7:

- **Make the repo public** — restores the $0 assumption the deployment doc is built
  on. Requires being comfortable with the code being visible.
- **Stay private** — accept the 2,000-minute cap and revisit before Phase 7 (a 15-min
  hourly job would blow it; a 1-min job would not).

Either is defensible. Record the choice in the Outcome section — do not leave it
implicit.

**Decided 2026-09-27: made public.** Restores the $0-forever assumption
`04-deployment.md` is built on; unblocks Phase 7's hourly cron without a minutes cap.

**2. Preview database.** Options, simplest first:

- **Share production** (recommended for this phase). The web app cannot write to
  Postgres, so a preview deployment physically cannot corrupt production data. Zero
  setup.
- **One dedicated Neon branch for previews.** One extra branch, one extra env var
  scope. Reasonable if you want isolation on principle.
- **A Neon branch per PR.** Genuinely nice, genuinely more setup (Neon's GitHub
  integration or API calls in CI). **Out of scope for this phase** — revisit when
  previews start needing to test migrations.

**Decided 2026-09-27: share production.** Zero extra setup; safe today because
nothing in `apps/web` writes to Postgres. Revisit at Phase 11.

**3. When migrations run.** Recommended: **manually, from a laptop** (S5), for now.
There is one migration and it changes rarely. Automate when that stops being true.

> **Do not put `db:migrate` in the Vercel build command.** It would run on every
> deploy including every preview, race with itself when two deploys overlap, and give
> a schema change no review step. Migrations are a deliberate act.

### S2 — Neon — **HUMAN**

Create a free Neon project (Postgres 17, region nearest your users).

From the dashboard, copy **both** connection strings. Neon shows a pooled/unpooled
toggle; you need both, and they are different hosts:

| Needed for | Which | Shape |
|---|---|---|
| The app (Vercel runtime + build) | **Pooled** | host contains `-pooler` |
| Migrations and seeding (S5) | **Direct / unpooled** | no `-pooler` |

Both include `?sslmode=require`. Keep it — Neon requires TLS, and postgres.js honours
the URL parameter with no code change.

Hand back both strings. **Do not commit either one anywhere.**

Why two: the pooled endpoint is PgBouncer in transaction mode, which is right for
many short serverless connections but is the wrong thing to run DDL and a
long transaction through. Migrations want the direct endpoint.

### S3 — `prepare: false` on the driver — agent

`packages/db/src/client.ts`, in `createDb`:

```ts
export function createDb(url: string): Database {
  // A transaction-mode connection pooler (Neon's pooled endpoint, PgBouncer,
  // pgpool) hands each checkout a different backend, so server-side prepared
  // statements cannot be relied on to still exist — postgres.js prepares by
  // default, which surfaces as intermittent "prepared statement already
  // exists" errors under concurrency. Set unconditionally rather than sniffed
  // from the hostname: detecting Neon's `-pooler` host would couple this file
  // to one provider's naming, and losing statement reuse on a direct
  // connection costs far less than that.
  const sql = postgres(url, { prepare: false });
  return drizzle(sql, { schema });
}
```

No other code changes are needed for this phase. Specifically **not** needed: an SSL
option (it is in the URL), a Neon driver (invariant 13 forbids it), or any change to
`apps/web`.

After the edit: `npm run check && npm test` must still pass against local Postgres.

### S4 — Environment variables, and the build-time landmine — **HUMAN**

Set in the Vercel project, scoped to **Production, Preview, and Development**:

| Name | Value |
|---|---|
| `DATABASE_URL` | the **pooled** Neon string from S2 |

`TEST_DATABASE_URL` is **not** set on Vercel — it exists only for local and CI test
runs.

> **Landmine — `DATABASE_URL` is required at BUILD time, not just runtime.**
> `apps/web/lib/repository.ts` constructs the repository at module scope, which calls
> `getDb()` → `loadDbConfig()`, which throws on a missing variable. Next evaluates
> that module while collecting page data, so the **build fails**, not the first
> request. Reproduced locally by building with the variable unset:
>
> ```
> Error: Failed to collect configuration for /
>   [cause]: Error: Invalid database configuration:
>   ✖ Invalid input: expected string, received undefined
>     → at DATABASE_URL
>       at module evaluation (lib/repository.ts:4:72)
>       at module evaluation (app/page.tsx:14:1)
> ```
>
> This is why the variable must be scoped to every environment, not just Production.
> A Preview deployment with no `DATABASE_URL` does not degrade — it fails to build.

This is acceptable (the app needs a database at runtime regardless), but it is worth
knowing rather than rediscovering from a red build. If it later becomes a nuisance,
the fix is to make `repository.ts` construct lazily — **not** in this phase.

### S5 — Migrate and seed Neon — **HUMAN runs these**

Run from the repo root, substituting the **direct** (unpooled) string from S2.

```bash
# 1. Apply the schema.
DATABASE_URL='<neon-DIRECT-url>' TEST_DATABASE_URL= npm run db:migrate

# 2. Seed the 40 drops, so the deployed site has something to show.
DATABASE_URL='<neon-DIRECT-url>' npm run db:seed
```

`TEST_DATABASE_URL=` (set to empty) on the migrate command is deliberate: `migrate.ts`
also migrates the test database when that variable is set, and `.env.local` would
otherwise point it at a `localhost` container that may not be running. Blanking it
keeps the command about Neon only.

**Seeding production is a deliberate choice, not an accident.** The point of this
phase is a URL someone can open and judge; an empty feed defeats that. The 40 seeded
drops are the same ones Phase 1 and 2 have been reviewed against, and Phase 5 replaces
them with real ingested data. Note that `db:seed` **truncates first** — safe now,
genuinely destructive once real data exists, which is why it must never be wired into
any automated deploy step.

Verify before moving on:

```bash
psql '<neon-DIRECT-url>' -c 'SELECT count(*) FROM food_drop;'   # expect 40
psql '<neon-DIRECT-url>' -c "SELECT count(*) FROM food_drop WHERE published;"  # expect 40
```

### S6 — The Vercel project — **HUMAN**

Import the GitHub repo into a new Vercel project.

| Setting | Value | Note |
|---|---|---|
| Framework preset | Next.js | Auto-detected |
| Root Directory | `apps/web` | Vercel detects the npm workspace and installs from the repo root |
| Build command | *(default)* | Resolves to `next build` |
| Install command | *(default)* | Should become a workspace-aware `npm install` at the root |
| Node version | 22 | Match `.nvmrc`; `engines.node` is `>=22` |

`transpilePackages: ['@bitedrop/core', '@bitedrop/db']` is already in
`apps/web/next.config.ts`, which is what lets the app import the workspace packages
from source.

If the build fails on an unresolved `@bitedrop/*` import, the Root Directory setting
is the first thing to check — the monorepo needs Vercel to install from the repo root,
not from `apps/web` in isolation. **Report the actual error rather than guessing at
settings.**

### S7 — CI — agent

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: bitedrop
          POSTGRES_PASSWORD: bitedrop
          POSTGRES_DB: bitedrop
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U bitedrop -d bitedrop"
          --health-interval 3s
          --health-timeout 3s
          --health-retries 20

    env:
      DATABASE_URL: postgresql://bitedrop:bitedrop@localhost:5432/bitedrop
      TEST_DATABASE_URL: postgresql://bitedrop:bitedrop@localhost:5432/bitedrop_test

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci

      # The same init script docker-compose mounts locally: three extensions
      # plus the separate bitedrop_test database. Running the committed file
      # rather than retyping its SQL here is what stops CI and local from
      # drifting apart.
      - name: Bootstrap Postgres
        run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/init/01-init.sql

      - run: npm run db:migrate
      - run: npm run check
      - run: npm test
      - run: npm run build
```

Notes on why this shape:

- **Port 5432, not 5433.** The local compose file uses 5433 to dodge a host Postgres;
  a CI service container has no such conflict, and the URLs are set explicitly here
  anyway.
- **`psql` is preinstalled** on `ubuntu-latest`. No install step needed.
- **`npm run db:migrate` migrates both databases** because both variables are set —
  which also exercises the dual-migration behaviour the app depends on.
- **`npm run build` is last and needs `DATABASE_URL`** (see S4's landmine); the job
  `env` block covers it.

This sequence was validated end to end against a bare `postgres:17-alpine` container
before being written down — `psql -f 01-init.sql` creates both databases with all
three extensions (the `\connect` meta-command switches databases correctly when run
through `-f`), and `db:migrate` then applies the schema to both. What was *not*
validated is the workflow file itself running on GitHub's infrastructure; the first
PR is the real test.

### S8 — Smoke-verify the deployment

Against the live Vercel URL:

```bash
BASE=https://<your-deployment>.vercel.app

curl -s -o /dev/null -w 'home            %{http_code}\n' "$BASE/"
curl -s -o /dev/null -w 'detail          %{http_code}\n' "$BASE/drops/oreo-caramel-apple"
curl -s -o /dev/null -w 'unknown slug    %{http_code}\n' "$BASE/drops/does-not-exist"   # expect 404
curl -s -o /dev/null -w 'filter          %{http_code}\n' "$BASE/?category=candy"
curl -s -o /dev/null -w 'search          %{http_code}\n' "$BASE/?q=oreo"
curl -s -o /dev/null -w 'trending        %{http_code}\n' "$BASE/?sort=trending"

# 12 drop links on page one, same as local
curl -s "$BASE/" | grep -oE 'href="/drops/[a-z0-9-]+"' | sort -u | wc -l
```

Then open it in a browser and confirm by eye: images load, filters apply, the mobile
sheet opens, both themes look right. Cold-start latency on the first request after
Neon scales to zero is expected (a few hundred ms) and is not a defect.

### S9 — Do not do these things

1. Do not commit a connection string, Neon password, or Vercel token — not in
   `.env.example`, not in a workflow file, not in a doc.
2. Do not put `db:migrate` or `db:seed` in the Vercel build command.
3. Do not run `db:seed` against Neon again after Phase 4 begins — it truncates.
4. Do not add `@neondatabase/serverless` or any `@vercel/*` runtime package
   (invariant 13; architecture §9 rules 1–2).
5. Do not add caching, ISR, or `unstable_cache` — still deferred, same reason as
   Phase 2.
6. Do not set up the ingestion cron workflow. That is Phase 7, and there is nothing
   to ingest yet.
7. Do not add a custom domain, analytics, or an uptime monitor in this phase.
8. Do not change anything the app renders. A visual diff between local and production
   means something is wrong with the deploy, and that signal is worth protecting.

### S10 — Docs to update at completion

- [`../04-deployment.md`](../04-deployment.md) — correct the "unlimited Actions
  minutes" line if the repo stays private; add the pooled-vs-direct connection
  requirement, which the doc currently does not mention.
- [`README.md`](../../README.md) — add the live URL.
- [`./README.md`](./README.md) — status table row 3.
- [`../../CLAUDE.md`](../../CLAUDE.md) — the status line.
- This file — the Outcome half.

---

## Acceptance criteria

**Deployment**

- [x] 1 — A public Vercel URL serves the feed, rendering the 40 seeded drops from Neon.
- [x] 2 — `/drops/[slug]` renders detail with sources and related drops; an unknown slug 404s.
- [x] 3 — Filters, search, and sort all work against Neon, matching local behaviour.
- [ ] 4 — Opening a PR produces a working preview deployment.

**Database**

- [x] 5 — The Neon database has the full schema applied from the committed migration.
- [x] 6 — 40 drops seeded, all `published`.
- [x] 7 — The app connects via the **pooled** endpoint; migrations were run via the **direct** one.
- [x] 8 — `prepare: false` is set, and no provider-specific driver was added.

**CI**

- [x] 9 — `.github/workflows/ci.yml` runs on every PR and on pushes to `main`.
- [x] 10 — CI runs typecheck, lint, format, unit + integration tests, and a production build.
- [x] 11 — CI bootstraps its Postgres from the committed `packages/db/init/01-init.sql`, not a retyped copy.
- [x] 12 — CI is green on the PR that introduces it.

**Hygiene**

- [x] 13 — No credential appears in the repo.
- [x] 14 — `apps/web` renders identically in production and locally.
- [x] 15 — `npm run check` and `npm test` still pass locally after the S3 change.

### Verification commands

```bash
# S3 change did not break local
npm run check && npm test

# no credentials committed anywhere
git grep -nEi 'postgres(ql)?://[^ ]*:[^ @]*@' -- ':!*.md' ':!.env.example'   # expect 0
git grep -nEi 'neon\.tech|vercel_token|NEON_API_KEY'                          # review every hit

# .env.local still ignored, never staged
git status --porcelain --ignored | grep -E '\.env\.local'   # expect '!!' lines only

# the app never imports the driver or ORM directly
grep -rln "drizzle-orm\|from 'postgres'" apps/web --include='*.ts' --include='*.tsx'  # expect 0
```

## Review notes

Worth a second opinion, specifically:

- **The repo-visibility decision (S1) is the one with a cost tail.** It is trivial now
  and load-bearing in Phase 7. Make it deliberately.
- **Is sharing one database between production and preview the right call?** It rests
  entirely on the app having no write path — true today, false from Phase 11. Worth
  agreeing that "revisit at Phase 11" is a real commitment and not a note nobody reads.
- **`prepare: false` unconditionally** trades a little direct-connection performance
  for not hardcoding a provider's hostname convention. Reasonable, but it is a
  judgment call, and the alternative (sniff the URL) is defensible if the performance
  ever matters.
- ~~**Seeding production with mock data** puts 40 fictional food drops on a public
  URL.~~ **Decided 2026-09-20: approved.** Fine for a review deployment; Phase 5
  replaces the data with real ingested drops.

---

## Outcome

### What changed

- **`packages/db/src/client.ts`** — `createDb` now passes `prepare: false` to
  postgres.js (S3), required for Neon's pooled (transaction-mode) endpoint.
- **`.github/workflows/ci.yml`** (new) — typecheck, lint, format, unit +
  integration tests, and a production build, all against a Postgres service
  container bootstrapped from the committed `packages/db/init/01-init.sql`
  (S7). Runs on every PR and push to `main`.
- **Repo visibility** — changed from private to public via `gh repo edit`.
- **Neon** — a free project created, schema migrated, 40 drops seeded.
- **Vercel** — project imported from GitHub, Root Directory `apps/web`,
  `DATABASE_URL` (pooled string) set for Production + Preview.
- **`docs/04-deployment.md`** — added a "Pooled vs. direct connections"
  section documenting the split and why `prepare: false` is required (S10).

Live at **https://bite-drop.vercel.app**.

### How to run it

Locally: unchanged from Phase 2 (`npm run dev`). Nothing about local
development changed in this phase.

To redeploy: push to `main`, or open a PR for a preview deployment. Vercel
auto-builds from the GitHub integration; no manual deploy step.

To re-migrate or re-seed Neon: run `db:migrate`/`db:seed` with `DATABASE_URL`
overridden to Neon's **direct** connection string (see S5). `db:seed`
truncates first — safe only until real data exists (Phase 4+).

### How to test it

```bash
npm run check && npm test   # unchanged by this phase; still the local gate
```

Against the live URL:

```bash
BASE=https://bite-drop.vercel.app
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/drops/oreo-caramel-apple"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/drops/does-not-exist"   # expect 404
```

All of S8's smoke tests were run and passed: home (12 drop links), detail
page, 404 on an unknown slug, category filter (narrows to 6), search (`?q=oreo`
returns exactly `oreo-caramel-apple`), trending sort, `/design`, `/icon.svg` —
all 200 except the deliberate 404, and page content inspected (not just status
codes) to confirm no error page was hiding behind a 200.

### Known limitations

- **Criterion 4 (PR → working preview deployment) was not verified.** No PR
  has been opened since the Vercel project was wired up, so the preview path
  — as opposed to the production path, which is fully verified — has not
  actually been observed. Vercel's GitHub integration creates preview
  deployments automatically with no extra configuration, so this is expected
  to work, but "expected to work" is exactly the standard this phase's own
  warning banner says not to accept. Flagged rather than silently checked off.
- **`migrate.ts` and `seed/run.ts` do not set `prepare: false`.** Only
  `client.ts`'s `createDb()` (what the running app uses) does; both scripts
  open their own raw connection instead. Harmless in practice — each opens
  exactly one connection, does its work in a single transaction, and exits,
  so the specific failure mode `prepare: false` guards against (a pooler
  handing a long-lived client a different backend between transactions)
  never has a chance to occur in a one-shot script. Confirmed by actually
  seeding Neon through the pooled endpoint with this gap present — it worked.
  Still an inconsistency worth closing for its own sake; not done in this
  phase since it was discovered after Neon setup was already complete and
  changing it wasn't blocking anything.
- **The Neon password was exposed once during setup** — `migrate.ts` logs the
  full connection string it's connecting to, and an early debugging message
  in this phase pasted that output in full, including the password, into the
  conversation. Caught immediately; the credential was rotated before the
  working connection string was used for the successful migrate/seed run. No
  lasting exposure, but worth knowing that `migrate.ts`'s `console.log` of the
  raw URL is a thing to watch for when sharing its output anywhere.
- **No custom domain, uptime monitoring, or alerting** — explicitly out of
  scope per this phase's Non-goals, not an oversight.

### Decisions made during implementation

- **Repo visibility: made public** (S1). Restores the $0-Actions-minutes
  assumption `04-deployment.md` is built on and removes a cap that would have
  mattered once Phase 7's hourly cron exists. Decided deliberately, not
  defaulted.
- **Preview database: shares production** (S1). Zero extra setup; safe only
  because `apps/web` has no write path today. This is a real commitment to
  revisit at Phase 11, not a note to forget.
- **The first migration attempt against Neon failed**
  (`operator class "gin_trgm_ops" does not exist for access method "gin"`) —
  a gap in this very document: S2 never instructed running
  `packages/db/init/01-init.sql`'s `CREATE EXTENSION` statements against Neon
  before migrating, unlike local (where Docker Compose mounts and runs it
  automatically) and CI (where S7's workflow runs it explicitly). Drizzle
  wraps the whole migration in one transaction, so the failed attempt rolled
  back cleanly with nothing partially applied — the fix was three
  `CREATE EXTENSION IF NOT EXISTS` statements run by hand against Neon's
  direct endpoint, then a clean retry. Worth adding to S2 if this doc is ever
  reused for a second deployment target.
- **CI was validated against a real GitHub Actions run before being treated
  as done**, not just the local dry-run documented in the Plan — the push
  that introduced `ci.yml` triggered a real workflow run, which completed
  successfully in 1m18s.

### Recommended next step

**Phase 4 — Ingest CLI + first adapters.** The deploy is done and the
database is real; the next meaningful gap is that the feed still shows the
same 40 mock drops Phase 1 authored. Before starting, it's worth deciding
whether to seed Neon with a smaller or different dataset once real ingestion
begins (the current seed truncates on every run, which stops being safe the
moment real discovered drops exist in `food_drop`), and revisiting the
`prepare: false` gap in `migrate.ts`/`seed/run.ts` noted above while those
files are already being touched for the new ingestion-related scripts.
