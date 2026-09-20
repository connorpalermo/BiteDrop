import { CATEGORIES, COUNTRIES, RETAILERS } from '@bitedrop/core';
import type { Database } from '../client';
import { category, country, retailer } from '../schema/index';

/** Retailer type classification — RETAILERS itself has no `type` field. */
const RETAILER_TYPES: Record<string, (typeof retailer.$inferInsert)['type']> = {
  target: 'mass',
  walmart: 'mass',
  costco: 'mass',
  kroger: 'grocery',
  cvs: 'pharmacy',
  walgreens: 'pharmacy',
  seven_eleven: 'convenience',
  circle_k: 'convenience',
  amazon: 'online',
  mcdonalds: 'restaurant',
  taco_bell: 'restaurant',
  wendys: 'restaurant',
  burger_king: 'restaurant',
  starbucks: 'restaurant',
  dunkin: 'restaurant',
  chick_fil_a: 'restaurant',
};

function retailerType(slug: string): (typeof retailer.$inferInsert)['type'] {
  const type = RETAILER_TYPES[slug];
  if (!type) throw new Error(`Seed: no retailer type mapped for slug "${slug}"`);
  return type;
}

interface ReferenceIds {
  categoryIds: Map<string, number>;
  retailerIds: Map<string, number>;
}

/** Seeds category, country, and retailer — the small, closed reference sets.
 * Returns the slug -> id lookups foodDrops.ts needs to resolve category_id
 * and retailer_id (country is keyed by its own natural key, `code`, so no
 * lookup is needed for it). */
export async function seedReferenceData(db: Database): Promise<ReferenceIds> {
  const insertedCategories = await db
    .insert(category)
    .values(
      CATEGORIES.map((c, index) => ({
        slug: c.slug,
        name: c.name,
        emoji: c.emoji,
        sortOrder: index,
      })),
    )
    .returning({ id: category.id, slug: category.slug });

  await db.insert(country).values(
    COUNTRIES.map((c) => ({
      code: c.code,
      name: c.name,
      emoji: c.emoji,
      region: c.region,
    })),
  );

  const insertedRetailers = await db
    .insert(retailer)
    .values(
      RETAILERS.map((r) => ({
        slug: r.slug,
        name: r.name,
        type: retailerType(r.slug),
      })),
    )
    .returning({ id: retailer.id, slug: retailer.slug });

  return {
    categoryIds: new Map(insertedCategories.map((row) => [row.slug, row.id])),
    retailerIds: new Map(insertedRetailers.map((row) => [row.slug, row.id])),
  };
}
