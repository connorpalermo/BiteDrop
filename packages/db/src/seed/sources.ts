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

  const rows = Array.from(byName.entries()).map(([name, url]) => ({
    slug: slugify(name),
    name,
    type: sourceType(name),
    url,
    trustTier: 2,
  }));

  const inserted = await db.insert(source).values(rows).returning({
    id: source.id,
    name: source.name,
  });

  return new Map(inserted.map((row) => [row.name, row.id]));
}
