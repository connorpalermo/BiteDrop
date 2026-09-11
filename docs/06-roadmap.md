# 06 — Roadmap

16 phases. Each one ends with something runnable that can be reviewed on its own,
and each is intended to be a single sitting's worth of review — not a week's.

The brief's 9 phases are preserved in spirit; they have been split where a phase
bundled two independently reviewable things, and reordered in two places (noted
in [`07-brief-feedback.md`](./07-brief-feedback.md)).

## Core product

| # | Phase | What you can run and review | Size |
|---|---|---|---|
| **1** | **UI prototype on mock data** | `npm run dev` → the full feed, filters, search, detail pages, responsive. No database. | M |
| **2** | **Database + real reads** | Same UI, now served from Postgres. Keyset pagination, FTS search, seeded data. | M |
| **3** | **Deploy** | A public URL on Vercel + Neon, CI green on PRs, preview deploys. | S |
| **4** | **Ingest CLI + first adapters** | `npm run ingest` populates `raw_item` from 2 real feeds. No FoodDrops yet. | M |
| **5** | **Filter + rule-based extraction** | Real FoodDrops appear in the feed from real sources, with **zero LLM**. | M |
| **6** | **Deduplication** | Four sources reporting one product → one drop with four sources. Regression corpus. | M |
| **7** | **Scheduling + observability** | Hourly GitHub Actions run; `/admin/health` shows per-source status. | S |
| **8** | **LLM extraction** | Extraction quality jumps; measured against the Phase 5 corpus. Provider swappable. | M |
| **9** | **Enrichment** | Retailer availability, trending scores, international regions. | M |
| **10** | **Source expansion** | 8–10 sources, HTML-listing adapter, Reddit via OAuth. | S |

## User accounts + BiteDrop AI

| # | Phase | What you can run and review | Size |
|---|---|---|---|
| **11** | **Auth + wishlist** | Sign in, save drops, view counts feeding trending. | M |
| **12** | **Agent A — tool-using chat** | Ask BiteDrop AI a question; watch it chain read-only tools, streamed. | L |
| **13** | **Agent B — actions** | "Add those to my wishlist" actually works, behind a permissioned write-tool boundary. | M |
| **14** | **Agent C — trend analysis** | `compare_periods`, `get_category_trends`, `get_brand_activity` + synthesis. | M |
| **15** | **Agent D — human-in-the-loop** | Agent pauses, persists to `agent_run`, resumes on approval. Survives a server restart. | M |
| **16** | **Agent E — BiteDrop Scout** | Scheduled job writes daily `ai_pick` rows; "Today's AI Picks" surface. | M |

## Why this ordering

**Deploy at Phase 3, not at the end.** Deployment problems are infrastructure
problems, and they are cheapest to solve when the app is a feed and a detail page.
Deferring the first deploy until there is an ingestion pipeline to debug means
debugging both at once. Phase 3 is also small — which is exactly why it should not
be saved for when it is not.

**Rule-based extraction (Phase 5) before LLM extraction (Phase 8).** This is the
largest change from the brief, and the reasoning is:

- It proves the entire `source → raw_item → FoodDrop → feed` path end-to-end with no
  API key, no cost, and no nondeterminism.
- It forces the deterministic filter to be genuinely good, because nothing else is
  catching the junk. The brief's quality bar is mostly a filter-quality problem, and
  an LLM available early is a way to avoid doing that work.
- It produces the **fixture corpus and baseline** that makes Phase 8 measurable. Without
  it, "the LLM extractor works" is an opinion.
- If Phase 8's free model proves too weak, Phases 1–7 are still a working product.

**Dedupe (Phase 6) before scheduling (Phase 7).** Running hourly before dedupe exists
means an hour-on-hour accumulation of duplicate FoodDrops to clean up. Get canonical
matching right while runs are still manual.

**Auth at Phase 11, not earlier.** Nothing before it needs a user. Building auth in
Phase 1 is building a login screen for an app with no content.

## Where the brief's phases landed

| Brief phase | Here |
|---|---|
| 1 — UI prototype | Phase 1 |
| 2 — Database | Phase 2 |
| 3 — First ingestion sources | Phase 4 |
| 4 — Classification/extraction | **Split:** Phase 5 (rules) + Phase 8 (LLM) |
| 5 — Deduplication | Phase 6 |
| 6 — Scheduled ingestion | Phase 7 |
| 7 — Enrichment | Phase 9 |
| 8 — More sources | Phase 10 |
| 9 — Social discovery | Folded into Phase 10; see feedback doc |
| Agent A–E | Phases 12–16 |
| *(new)* | Phase 3 — Deploy; Phase 11 — Auth |
