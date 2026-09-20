# Phase Records

One document per phase, committed alongside the phase it describes.

Each document has two halves:

- **Plan** — goal, non-goals, build order, acceptance criteria. Written and reviewed
  *before* implementation starts. This is the contract for the phase.
- **Outcome** — what changed, how to run it, how to test it, known limitations,
  decisions made during implementation, recommended next step. Written *after*.

Keeping both in one file is deliberate: a separate plan doc and record doc drift
apart, and the interesting information is precisely the gap between them — which
the **Decisions made during implementation** section exists to capture.

Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a phase.

## Workflow

1. **Before starting** — write the Plan and Acceptance criteria halves, then get
   review before writing code.
2. **During** — leave the document alone unless the plan itself changes. If it does,
   amend it and note the change rather than silently rewriting it.
3. **At completion** — fill in the Outcome half, tick the acceptance criteria, and
   update the status table below.
4. **Then** — update the status line at the top of [`../../CLAUDE.md`](../../CLAUDE.md).
   Stop for review before starting the next phase.

Phase work is left in the working tree for the repo owner to commit as they see fit.

## Status

| # | Phase | Status | Record |
|---|---|---|---|
| 1 | UI prototype on mock data | **Complete — awaiting review** | [phase-01](./phase-01-ui-prototype.md) |
| 2 | Database + real reads | **Complete — awaiting review** | [phase-02](./phase-02-database.md) |
| 3 | Deploy | Not started | — |
| 4 | Ingest CLI + first adapters | Not started | — |
| 5 | Filter + rule-based extraction | Not started | — |
| 6 | Deduplication | Not started | — |
| 7 | Scheduling + observability | Not started | — |
| 8 | LLM extraction | Not started | — |
| 9 | Enrichment | Not started | — |
| 10 | Source expansion | Not started | — |
| 11 | Auth + wishlist | Not started | — |
| 12 | Agent A — tool-using chat | Not started | — |
| 13 | Agent B — actions | Not started | — |
| 14 | Agent C — trend analysis | Not started | — |
| 15 | Agent D — human-in-the-loop | Not started | — |
| 16 | Agent E — BiteDrop Scout | Not started | — |

Phase scope and ordering rationale live in [`../06-roadmap.md`](../06-roadmap.md).
