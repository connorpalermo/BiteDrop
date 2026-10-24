import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { startFetchRun } from '../src/repositories/fetchRunRepository';
import { insertRawItems, type InsertableRawItem } from '../src/repositories/rawItemRepository';
import { listIngestSources } from '../src/repositories/sourceRepository';
import { getTestDb, resetTestDb } from './testDb';

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

function item(url: string): InsertableRawItem {
  return {
    url,
    urlHash: hashUrl(url),
    contentHash: null,
    title: 'Title',
    author: null,
    publishedAt: null,
    excerpt: null,
    bodyText: null,
    imageUrl: null,
    rawPayload: { url },
  };
}

describe('rawItemRepository.insertRawItems', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('inserts new rows and returns the count actually inserted', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const runId = await startFetchRun(db, brandEating!.id);

    const itemsNew = await insertRawItems(db, brandEating!.id, runId, [
      item('https://www.brandeating.com/a'),
      item('https://www.brandeating.com/b'),
    ]);
    expect(itemsNew).toBe(2);
  });

  it('is idempotent: re-inserting the same canonical URLs returns 0 (invariant 8)', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const runId = await startFetchRun(db, brandEating!.id);

    const firstRun = await insertRawItems(db, brandEating!.id, runId, [
      item('https://www.brandeating.com/repeat'),
    ]);
    const secondRun = await insertRawItems(db, brandEating!.id, runId, [
      item('https://www.brandeating.com/repeat'),
    ]);
    expect(firstRun).toBe(1);
    expect(secondRun).toBe(0);
  });

  it('the same URL for two different sources is not a conflict (per-source uniqueness)', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const runA = await startFetchRun(db, brandEating!.id);
    const runB = await startFetchRun(db, prNewswire!.id);

    const sharedUrl = 'https://wire-service.example.com/shared-article';
    const a = await insertRawItems(db, brandEating!.id, runA, [item(sharedUrl)]);
    const b = await insertRawItems(db, prNewswire!.id, runB, [item(sharedUrl)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('returns 0 for an empty batch without issuing an insert', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const runId = await startFetchRun(db, brandEating!.id);
    expect(await insertRawItems(db, brandEating!.id, runId, [])).toBe(0);
  });
});
