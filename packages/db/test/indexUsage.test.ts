import { sql } from 'drizzle-orm';
import { beforeAll, describe, it } from 'vitest';
import { getTestDb, resetTestDb } from './testDb';

/**
 * All five food_drop feed/filter indexes share the identical partial
 * predicate (`WHERE published AND merged_into_id IS NULL`), so at only 40
 * seeded rows Postgres treats them as cost-equivalent and is free to pick
 * any one of them to satisfy the WHERE clause, then sort separately —
 * disabling seqscan and even bitmap scans doesn't stop it from picking the
 * "wrong" index this way, since a 40-row scan is cheap however it's done.
 *
 * The only deterministic way to prove a specific index is genuinely usable
 * by the query it was named for is to remove its same-predicate competitors
 * so it's the only candidate — done here inside a transaction that always
 * rolls back, so the schema is untouched afterward.
 */
async function assertIndexIsUsableExclusively(
  indexUnderTest: string,
  orderColumn: 'first_seen_at' | 'trending_score',
): Promise<void> {
  const db = getTestDb();
  const allFeedIndexes = [
    'food_drop_feed_idx',
    'food_drop_trending_idx',
    'food_drop_category_idx',
    'food_drop_brand_idx',
    'food_drop_status_idx',
  ];
  const competitors = allFeedIndexes.filter((name) => name !== indexUnderTest);

  await db.execute(sql`BEGIN`);
  try {
    await db.execute(sql.raw(`DROP INDEX ${competitors.join(', ')}`));
    await db.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await db.execute<{ 'QUERY PLAN': string }>(
      sql.raw(`
        EXPLAIN SELECT id FROM food_drop
        WHERE published AND merged_into_id IS NULL
        ORDER BY ${orderColumn} DESC, id DESC LIMIT 13
      `),
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    if (!plan.includes(indexUnderTest)) {
      throw new Error(`Expected plan to use ${indexUnderTest}, got:\n${plan}`);
    }
  } finally {
    await db.execute(sql`ROLLBACK`);
  }
}

describe('index usage', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('the default (newest) feed query can use food_drop_feed_idx', async () => {
    await assertIndexIsUsableExclusively('food_drop_feed_idx', 'first_seen_at');
  });

  it('the trending feed query can use food_drop_trending_idx', async () => {
    await assertIndexIsUsableExclusively('food_drop_trending_idx', 'trending_score');
  });
});
