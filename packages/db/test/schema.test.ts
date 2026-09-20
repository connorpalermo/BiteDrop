import { CATEGORIES, COUNTRIES, dropStatusSchema } from '@bitedrop/core';
import { asc, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { category, country } from '../src/schema/index';
import { getTestDb, resetTestDb } from './testDb';

const FEED_PARTIAL_INDEXES = [
  'food_drop_feed_idx',
  'food_drop_trending_idx',
  'food_drop_category_idx',
  'food_drop_brand_idx',
  'food_drop_status_idx',
] as const;

const ALL_REQUIRED_INDEXES = [
  ...FEED_PARTIAL_INDEXES,
  'food_drop_search_idx',
  'food_drop_name_trgm_idx',
  'brand_normalized_trgm_idx',
  'brand_alias_uniq',
  'food_drop_country_lookup_idx',
  'food_drop_source_raw_idx',
  'raw_item_url_hash_idx',
  'raw_item_content_hash_idx',
  'raw_item_queue_idx',
  'fetch_run_source_time_idx',
] as const;

describe('schema', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('drop_status enum members match dropStatusSchema, in order', async () => {
    const db = getTestDb();
    const rows = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = 'drop_status'::regtype
      ORDER BY enumsortorder
    `);
    expect(rows.map((r) => r.enumlabel)).toEqual([...dropStatusSchema.options]);
  });

  it('seeded category slugs match CATEGORIES, in order', async () => {
    const db = getTestDb();
    const rows = await db
      .select({ slug: category.slug })
      .from(category)
      .orderBy(asc(category.sortOrder));
    expect(rows.map((r) => r.slug)).toEqual(CATEGORIES.map((c) => c.slug));
  });

  it('seeded country codes match COUNTRIES', async () => {
    const db = getTestDb();
    const rows = await db.select({ code: country.code }).from(country);
    expect(new Set(rows.map((r) => r.code))).toEqual(new Set(COUNTRIES.map((c) => c.code)));
  });

  it('every required index exists', async () => {
    const db = getTestDb();
    const rows = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = new Set(rows.map((r) => r.indexname));
    for (const name of ALL_REQUIRED_INDEXES) {
      expect(names.has(name), `missing index ${name}`).toBe(true);
    }
  });

  it('every feed/filter index on food_drop is partial on published + non-tombstoned', async () => {
    const db = getTestDb();
    // Filtering the index-name list in JS, not via a raw `= ANY($array)` SQL
    // template — see feedQuery.ts's countryFilter comment for why that
    // pattern doesn't reliably parameterise a JS array with postgres.js.
    const allRows = await db.execute<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'food_drop'`,
    );
    const byName = new Map(allRows.map((r) => [r.indexname, r.indexdef]));
    for (const name of FEED_PARTIAL_INDEXES) {
      expect(byName.get(name), `missing index ${name}`).toContain(
        'WHERE (published AND (merged_into_id IS NULL))',
      );
    }
  });
});
