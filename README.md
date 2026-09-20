# BiteDrop

A discovery feed for new, unusual, and limited-time food releases worldwide.

BiteDrop aggregates food drops from many sources and resolves them into a single
canonical **Food Drop** per product — so one new Oreo flavour discussed by ten
outlets appears once, with ten sources attached.

## Status

**Phase 2 of 16.** The feed, filters, search, and detail pages run against a real
Postgres database. Phases 1 (UI on mock data) and 2 (database + real reads) are
built and self-verified, awaiting review — see [`docs/phases/`](./docs/phases) for
per-phase records and [`CLAUDE.md`](./CLAUDE.md) for the current status line.

## Quick start

```bash
nvm use
npm install
cp .env.example .env.local
npm run dev   # starts Postgres in Docker, migrates, seeds, then next dev
```

Then open http://localhost:3000. See [`docs/03-local-dev.md`](docs/03-local-dev.md)
for the full command reference.

## Documentation

| Doc | Contents |
|---|---|
| [`docs/01-architecture.md`](docs/01-architecture.md) | System design, components, key decisions |
| [`docs/02-data-model.md`](docs/02-data-model.md) | Database schema, indexes, pagination, search |
| [`docs/03-local-dev.md`](docs/03-local-dev.md) | Local development environment |
| [`docs/04-deployment.md`](docs/04-deployment.md) | Free-tier deployment architecture |
| [`docs/05-sources.md`](docs/05-sources.md) | Verified ingestion sources |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | Phased delivery plan |
| [`docs/07-brief-feedback.md`](docs/07-brief-feedback.md) | Proposed changes to the original brief |
| [`docs/phases/`](docs/phases) | Per-phase plans and completion records |
| [`CLAUDE.md`](CLAUDE.md) | Development principles, settled decisions, invariants |

## Licence

Unlicensed / private.
