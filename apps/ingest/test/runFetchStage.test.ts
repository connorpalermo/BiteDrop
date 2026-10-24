import type { DiscoveredItem, SourceAdapter } from '@bitedrop/core';
import { schema } from '@bitedrop/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchStageDeps } from '../src/runFetchStage';
import { runFetchStage } from '../src/runFetchStage';
import { getTestDb, resetTestDb } from './testDb';

const { fetchRun, rawItem, source } = schema;

const FAKE_ITEM: DiscoveredItem = {
  url: 'https://example.com/fake-article',
  title: 'Fake Article',
  author: null,
  publishedAt: null,
  excerpt: null,
  bodyText: null,
  imageUrl: null,
  rawPayload: { fake: true },
};

function fakeAdapter(failingSlug: string | null): SourceAdapter {
  return {
    type: 'rss',
    fetch(src) {
      if (src.slug === failingSlug) return Promise.reject(new Error('simulated adapter failure'));
      return Promise.resolve({
        items: [FAKE_ITEM],
        etag: null,
        lastModified: null,
        notModified: false,
      });
    },
  };
}

function depsWithFailingSource(failingSlug: string | null): FetchStageDeps {
  const adapter = fakeAdapter(failingSlug);
  return { getAdapter: () => adapter, isFetchAllowed: () => Promise.resolve(true) };
}

async function sourceIdFor(slug: string): Promise<string> {
  const db = getTestDb();
  const [row] = await db.select({ id: source.id }).from(source).where(eq(source.slug, slug));
  return row!.id;
}

describe('runFetchStage', () => {
  beforeEach(async () => {
    await resetTestDb();
  }, 30_000);

  it('isolates a failing source: the other source still succeeds (invariant 7)', async () => {
    const db = getTestDb();
    const results = await runFetchStage(
      db,
      { dryRun: false },
      depsWithFailingSource('prnewswire-rss'),
    );

    const failed = results.find((r) => r.sourceSlug === 'prnewswire-rss')!;
    const ok = results.find((r) => r.sourceSlug === 'brandeating-rss')!;
    expect(failed.status).toBe('error');
    expect(ok.status).toBe('success');
    expect(ok.itemsNew).toBe(1);

    const prNewswireId = await sourceIdFor('prnewswire-rss');
    const runs = await db.select().from(fetchRun).where(eq(fetchRun.sourceId, prNewswireId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('error');
  });

  it('is idempotent: running twice inserts itemsNew=0 the second time', async () => {
    const db = getTestDb();
    const deps = depsWithFailingSource(null);

    const first = await runFetchStage(db, { sourceSlug: 'brandeating-rss', dryRun: false }, deps);
    const second = await runFetchStage(db, { sourceSlug: 'brandeating-rss', dryRun: false }, deps);
    expect(first[0]!.itemsNew).toBe(1);
    expect(second[0]!.itemsNew).toBe(0);
  });

  it('--dry-run writes nothing to raw_item, fetch_run, or source', async () => {
    const db = getTestDb();
    const before = {
      rawItems: (await db.select().from(rawItem)).length,
      fetchRuns: (await db.select().from(fetchRun)).length,
    };

    const results = await runFetchStage(
      db,
      { sourceSlug: 'brandeating-rss', dryRun: true },
      depsWithFailingSource(null),
    );
    expect(results[0]!.status).toBe('success');
    expect(results[0]!.itemsSeen).toBe(1);
    expect(results[0]!.itemsNew).toBe(0);

    const after = {
      rawItems: (await db.select().from(rawItem)).length,
      fetchRuns: (await db.select().from(fetchRun)).length,
    };
    expect(after).toEqual(before);
  });

  it('--source restricts the run to exactly one source', async () => {
    const db = getTestDb();
    const results = await runFetchStage(
      db,
      { sourceSlug: 'brandeating-rss', dryRun: false },
      depsWithFailingSource(null),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.sourceSlug).toBe('brandeating-rss');
  });

  it('a blocked robots.txt result writes no fetch_run row', async () => {
    const db = getTestDb();
    const results = await runFetchStage(
      db,
      { sourceSlug: 'brandeating-rss', dryRun: false },
      { getAdapter: () => fakeAdapter(null), isFetchAllowed: () => Promise.resolve(false) },
    );
    expect(results[0]!.status).toBe('robots_blocked');

    const brandEatingId = await sourceIdFor('brandeating-rss');
    const runs = await db.select().from(fetchRun).where(eq(fetchRun.sourceId, brandEatingId));
    expect(runs).toHaveLength(0);
  });
});
