import { normalizeName } from '@bitedrop/core';
import { RAW_MOCK_DROPS } from '@bitedrop/core/mock';
import type { Database } from '../client';
import { brand } from '../schema/index';

/**
 * Seeds `brand` from the distinct non-null brand refs across RAW_MOCK_DROPS.
 * Returns a lookup from brand slug -> the inserted brand's id, for
 * foodDrops.ts to resolve food_drop.brand_id.
 */
export async function seedBrands(db: Database): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>(); // slug -> name
  for (const raw of RAW_MOCK_DROPS) {
    if (raw.brand) bySlug.set(raw.brand.slug, raw.brand.name);
  }

  if (bySlug.size === 0) return new Map();

  const rows = Array.from(bySlug.entries()).map(([slug, name]) => ({
    slug,
    name,
    normalizedName: normalizeName(name),
  }));

  const inserted = await db.insert(brand).values(rows).returning({
    id: brand.id,
    slug: brand.slug,
  });

  return new Map(inserted.map((row) => [row.slug, row.id]));
}
