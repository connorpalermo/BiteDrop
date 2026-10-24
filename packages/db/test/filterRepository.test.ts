import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyFilterVerdicts, listDiscoveredRawItems } from '../src/repositories/filterRepository';
import { listIngestSources } from '../src/repositories/sourceRepository';
import { rawItem } from '../src/schema/index';
import { getTestDb, resetTestDb } from './testDb';

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

async function insertDiscoveredItem(
  db: ReturnType<typeof getTestDb>,
  sourceId: string,
  url: string,
  title: string,
): Promise<string> {
  const [row] = await db
    .insert(rawItem)
    .values({ sourceId, url, urlHash: hashUrl(url), title, stage: 'discovered' })
    .returning({ id: rawItem.id });
  return row!.id;
}

describe('filterRepository', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('listDiscoveredRawItems only returns stage=discovered rows, scoped by sourceId', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');

    const idA = await insertDiscoveredItem(db, brandEating!.id, 'https://example.com/a', 'A');
    await insertDiscoveredItem(db, prNewswire!.id, 'https://example.com/b', 'B');

    const scoped = await listDiscoveredRawItems(db, brandEating!.id);
    expect(scoped.map((i) => i.id)).toEqual([idA]);

    const all = await listDiscoveredRawItems(db);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('applyFilterVerdicts moves rows to candidate/rejected with the right filter_reason', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const passId = await insertDiscoveredItem(
      db,
      brandEating!.id,
      'https://example.com/pass',
      'Pass',
    );
    const rejectId = await insertDiscoveredItem(
      db,
      brandEating!.id,
      'https://example.com/reject',
      'Reject',
    );

    await applyFilterVerdicts(db, [
      { rawItemId: passId, passed: true, reason: null },
      { rawItemId: rejectId, passed: false, reason: 'no_food_signal' },
    ]);

    const [passedRow] = await db.select().from(rawItem).where(eq(rawItem.id, passId));
    const [rejectedRow] = await db.select().from(rawItem).where(eq(rawItem.id, rejectId));
    expect(passedRow!.stage).toBe('candidate');
    expect(passedRow!.filterReason).toBeNull();
    expect(rejectedRow!.stage).toBe('rejected');
    expect(rejectedRow!.filterReason).toBe('no_food_signal');
  });

  it('applyFilterVerdicts with an empty array is a no-op', async () => {
    await expect(applyFilterVerdicts(getTestDb(), [])).resolves.toBeUndefined();
  });
});
