# 04 — Free-Tier Deployment

All limits below were verified in September 2026 rather than assumed; sources are
linked at the bottom. Re-check before relying on any of them.

## Recommended architecture

```
   GitHub repo (public)
        │
        ├── push ──────────▶ Vercel Hobby ──▶ Next.js web app
        │                         │
        │                         └── reads ─┐
        │                                    │
        └── Actions cron (hourly) ──▶ ingest │──▶ Neon Postgres (free)
                 plain Node process   writes ─┘
```

| Component | Platform | Free allowance | Cost |
|---|---|---|---|
| Web app | Vercel Hobby | 100 GB bandwidth/mo, native Next.js | $0 |
| Database | Neon Free | 0.5 GB storage, 100 CU-hours/mo, auto-suspend/resume | $0 |
| Ingestion cron | GitHub Actions | Unlimited minutes on public repos | $0 |
| CI | GitHub Actions | same | $0 |
| Secrets | Vercel env vars + Actions secrets | — | $0 |
| Observability | `fetch_run` / `source` tables + `/admin/health` | — | $0 |
| **Total** | | | **$0** |

## Decision 1 — Why not Next.js on Cloudflare Workers

The brief leans toward Cloudflare, and `@opennextjs/cloudflare` does make it work.
I recommend Vercel Hobby for the web app anyway, for one specific reason:

**The Workers free plan allows 10 ms CPU time per request.** Server-rendering a feed
page of React is plausibly over that budget, and the failure mode is bad — requests
start erroring under exactly the conditions you would want to celebrate. The paid
plan raises it to 30 s, so this is effectively a $5/month requirement that the brief
rules out.

(One upside worth recording: the Worker *bundle size* limit is 64 MiB uncompressed on
both free and paid plans, not the 3 MiB figure that circulates in older posts. Bundle
size is not the blocker here — CPU time is.)

Vercel Hobby has no equivalent per-request CPU cliff, supports Next.js natively with
no adapter, and gives preview deployments per PR for free. The app holds no
Vercel-specific code, so moving to Cloudflare later is a deploy-config change.

## Decision 2 — Why ingestion runs on GitHub Actions, not a Workers cron

Cloudflare cron triggers would work (5 per account on free), but the ingestion job
wants things a Worker makes awkward:

- **Runtime.** A full crawl of 10 sources plus extraction exceeds what a Worker
  invocation is shaped for; a GitHub runner has no meaningful limit.
- **Full Node.** `cheerio`, XML parsing, and Postgres drivers all just work, with no
  compatibility flags or polyfills.
- **Identical local and CI execution.** `npm run ingest` runs the same code path on a
  laptop and in CI. That is the single biggest debugging advantage available, and
  Workers cannot offer it.
- **Free logs and retries.** Workflow run history is the observability layer, at no cost.

Because ingestion is a plain CLI, moving it to a Worker cron, a Fly machine, or a VPS
crontab later is a scheduler change with no code change.

```yaml
# .github/workflows/ingest.yml
name: ingest
on:
  schedule: [{ cron: "17 * * * *" }]   # hourly, off the hour — shared runners are
  workflow_dispatch:                   # congested at :00
concurrency:
  group: ingest                        # never two runs at once
  cancel-in-progress: false
jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run ingest
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

The `concurrency` group is what keeps overlapping runs from fighting, complementing
the `UNIQUE (source_id, url_hash)` constraint that makes the work idempotent anyway.

### Two caveats to plan around

- **Scheduled workflows are auto-disabled after 60 days with no commits.** Harmless
  during active development; needs a keepalive commit or an external pinger if the
  project goes quiet.
- **Scheduled runs need a public repo** (or GitHub Pro) to be free and reliable, and
  shared-runner scheduling can drift by minutes. "Approximately hourly" from the brief
  tolerates this fine.

## Decision 3 — Neon over Supabase

The brief suggests Supabase or another genuinely free Postgres. I recommend Neon:

| | Neon Free | Supabase Free |
|---|---|---|
| Idle behaviour | Scales to zero after 5 min, **auto-resumes** | **Pauses after 7 days idle, manual unpause required** |
| Storage | 0.5 GB | 0.5 GB |
| Branching | 10 branches/project — a real DB per PR | — |
| Lock-in | Plain Postgres over the wire | Plain Postgres, but the ecosystem pulls toward Supabase auth/client/RLS |

The deciding factor is the **manual unpause**. A hobby project that goes quiet for a
week comes back to a dead database requiring a dashboard visit — and since hourly
ingestion is what would keep it alive, any pause in the cron cascades into a pause in
the database. Neon's auto-resume removes that failure mode entirely.

We are also not using any of Supabase's differentiators (auth, storage, realtime,
RLS) — wishlist auth in Phase 11 is served by Auth.js with a Postgres adapter — so
choosing Supabase would mean accepting its footgun for features we do not use.

Branching is a genuine bonus: preview deployments can get their own database.

### The real constraint: 0.5 GB

This is the binding limit, and `raw_item.body_text` is what will consume it. Mitigations,
in the order they become necessary: cap `body_text` at 40k chars (Phase 4), prune
`fetch_run` beyond 30 days (Phase 7), then offload body text to Cloudflare R2 keyed by
content hash (10 GB free) if it still grows. Tracked as an explicit watch item with a
disk-usage check on the admin health page.

## LLM hosting (Phase 8)

Two viable paths behind the same `LlmProvider` interface:

| Option | Cost | Trade-off |
|---|---|---|
| **Cloudflare Workers AI** | $0 — 10,000 neurons/day, no card | Genuinely free; small open models, so extraction quality needs validating against the fixture corpus |
| **Claude Haiku 4.5 via Batch API** | ~$2–3/month at projected volume | Much better structured extraction; not $0, needs your approval |

Estimate for the paid option: ~50 candidate articles/day at ~1.5k input + 400 output
tokens ≈ 2.2M input + 0.6M output per month. At Haiku 4.5 batch rates ($0.50/$2.50
per MTok, 50% of standard) that is roughly **$2.60/month**.

Recommendation: build Phase 8 against Workers AI to hold the $0 line, and keep the
Batch path as a one-line config change if quality proves insufficient. Either way
the pipeline runs without an LLM at all through Phase 7, so this decision can wait
until there is real data to judge it on.

## Image hosting — an open question

The brief wants large, fast food imagery, and this is the one piece with no clean
free answer. Flagging it now rather than discovering it in Phase 9:

- **Phases 1–8:** reference source image URLs directly via `next/image` with an
  explicit `remotePatterns` allowlist. Works, costs nothing, but depends on other
  people's hosting and counts against Vercel's image-optimisation quota.
- **Phase 9 onward:** mirror images into Cloudflare R2 (10 GB free, no egress fees)
  during ingestion — the `image_stored_key` column already exists for this. Better
  for load time and immune to link rot.

## CI

```yaml
# .github/workflows/ci.yml — on every PR
- typecheck (tsc --noEmit, all workspaces)
- lint (eslint) + format check (prettier)
- unit + integration tests (Vitest, against a Postgres service container)
- migration check (migrations apply cleanly to an empty DB)
- build (next build)
```

## Sources

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — 10 ms CPU free plan, 64 MiB bundle, 5 cron triggers
- [Neon free plan limits](https://neon.com/faqs/free-plan-limits-and-quotas) — 0.5 GB, 100 CU-hours, scale-to-zero
- [Supabase pricing](https://uibakery.io/blog/supabase-pricing) — 500 MB, 7-day pause
- [Vercel limits](https://vercel.com/docs/limits) and [cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing) — Hobby crons once daily
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) — unlimited on public repos
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — 10,000 neurons/day free
- [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare)
