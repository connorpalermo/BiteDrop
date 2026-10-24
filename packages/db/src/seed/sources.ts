import { RAW_MOCK_DROPS, sourcesFor } from '@bitedrop/core/mock';
import type { Database } from '../client';
import { source } from '../schema/index';

/** Source type classification for the 8 publications in packages/core/src/mock/data.ts. */
const SOURCE_TYPES: Record<string, (typeof source.$inferInsert)['type']> = {
  'Brand Eating': 'rss',
  'PR Newswire': 'rss',
  'The Takeout': 'rss',
  Foodbeast: 'rss',
  Delish: 'rss',
  Eater: 'rss',
  'r/snackexchange': 'reddit',
  YouTube: 'youtube',
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sourceType(name: string): (typeof source.$inferInsert)['type'] {
  const type = SOURCE_TYPES[name];
  if (!type) throw new Error(`Seed: no source type mapped for publication "${name}"`);
  return type;
}

/**
 * Real feed endpoints for the two sources Phase 4 actually fetches from.
 * Every other seeded publication keeps its Phase 1/2 mock base URL as a
 * placeholder — real for those comes in Phase 6/10.
 *
 * Brand Eating's `alt=rss` URL 302-redirects to a FeedBurner Atom feed, not
 * RSS (verified live 2026-10-24, docs/phases/phase-04-ingest.md S4) — the
 * rssAdapter detects the format itself, so the placeholder "-rss" slug
 * suffix here just follows this project's naming, not the wire format.
 */
const REAL_FEED_OVERRIDES: Record<
  string,
  { slug: string; url: string; homepageUrl: string; trustTier: number }
> = {
  'Brand Eating': {
    slug: 'brandeating-rss',
    url: 'https://www.brandeating.com/feeds/posts/default?alt=rss',
    homepageUrl: 'https://www.brandeating.com/',
    trustTier: 2,
  },
  'PR Newswire': {
    slug: 'prnewswire-rss',
    url: 'https://www.prnewswire.com/rss/food-beverage-latest-news/food-beverage-latest-news-list.rss',
    homepageUrl: 'https://www.prnewswire.com/',
    trustTier: 1, // official/first-party — docs/05-sources.md
  },
};

/**
 * Seeds `source` from the distinct publications the mock data's sourcesFor()
 * actually produces, rather than a hand-typed duplicate list — so this can
 * never drift from packages/core/src/mock/data.ts's PUBLICATIONS.
 *
 * Returns a lookup from sourceName -> the inserted source's id, for
 * foodDrops.ts to resolve food_drop_source.source_id.
 */
export async function seedSources(db: Database): Promise<Map<string, string>> {
  const byName = new Map<string, string>(); // name -> base url
  for (const raw of RAW_MOCK_DROPS) {
    for (const src of sourcesFor(raw)) {
      byName.set(src.sourceName, src.url);
    }
  }

  const rows = Array.from(byName.entries()).map(([name, mockUrl]) => {
    const override = REAL_FEED_OVERRIDES[name];
    return {
      slug: override?.slug ?? slugify(name),
      name,
      type: sourceType(name),
      url: override?.url ?? mockUrl,
      homepageUrl: override?.homepageUrl,
      trustTier: override?.trustTier ?? 2,
      // Only Brand Eating/PR Newswire have a real feed URL and a working
      // adapter today. The other 6 are seeded with a mock placeholder URL
      // (often just the publication's homepage) — `enabled: true` on those
      // would make `npm run ingest` (no --source filter) actually fetch each
      // one, discover it isn't a real feed, and burn the full retry/backoff
      // budget per source for no reason. Flip to true in Phase 6/10 as each
      // one gets a real feed + adapter.
      enabled: override !== undefined,
    };
  });

  const inserted = await db.insert(source).values(rows).returning({
    id: source.id,
    name: source.name,
  });

  return new Map(inserted.map((row) => [row.name, row.id]));
}
