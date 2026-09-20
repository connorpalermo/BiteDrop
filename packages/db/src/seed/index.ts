import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { seedBrands } from './brands';
import { seedFoodDrops } from './foodDrops';
import { seedReferenceData } from './referenceData';
import { seedSources } from './sources';

const TABLES_IN_TRUNCATE_ORDER = [
  'food_drop_merge',
  'food_drop_retailer',
  'food_drop_country',
  'food_drop_source',
  'raw_item',
  'fetch_run',
  'food_drop',
  'brand_alias',
  'brand',
  'source',
  'retailer',
  'country',
  'category',
] as const;

/** Makes the seed idempotent: running it twice leaves the database in the
 * same state as running it once. */
async function truncateAll(db: Database): Promise<void> {
  const tables = sql.join(
    TABLES_IN_TRUNCATE_ORDER.map((t) => sql.identifier(t)),
    sql`, `,
  );
  await db.execute(sql`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Seeds the entire database from the mock data, in one transaction.
 * `fetch_run`, `brand_alias`, and `food_drop_merge` are left empty — nothing
 * reads them yet.
 */
export async function seedDatabase(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await truncateAll(tx);
    const { categoryIds, retailerIds } = await seedReferenceData(tx);
    const brandIds = await seedBrands(tx);
    const sourceIds = await seedSources(tx);
    await seedFoodDrops(tx, { categoryIds, retailerIds, brandIds, sourceIds });
  });
}
