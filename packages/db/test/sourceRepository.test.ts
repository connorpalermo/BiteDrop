import { beforeAll, describe, expect, it } from 'vitest';
import { listIngestSources, updateSourceHealth } from '../src/repositories/sourceRepository';
import { source } from '../src/schema/index';
import { eq } from 'drizzle-orm';
import { getTestDb, resetTestDb } from './testDb';

describe('sourceRepository', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('listIngestSources returns only enabled sources', async () => {
    const db = getTestDb();
    const sources = await listIngestSources(db);
    expect(sources.length).toBeGreaterThan(0);
  });

  it('listIngestSources(filterSlug) narrows to exactly one source', async () => {
    const db = getTestDb();
    const sources = await listIngestSources(db, 'brandeating-rss');
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toBe('Brand Eating');
    expect(sources[0]!.url).toBe('https://www.brandeating.com/feeds/posts/default?alt=rss');
  });

  it('prnewswire-rss is seeded at trust tier 1', async () => {
    const db = getTestDb();
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    expect(prNewswire).toBeDefined();
    const [row] = await db.select().from(source).where(eq(source.slug, 'prnewswire-rss'));
    expect(row!.trustTier).toBe(1);
  });

  it('updateSourceHealth resets consecutiveFailures to 0 and sets lastSuccessAt on success', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    await updateSourceHealth(db, brandEating!.id, {
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
      httpEtag: '"abc"',
      httpLastModified: 'Fri, 23 Oct 2026 10:00:00 GMT',
    });
    const [row] = await db.select().from(source).where(eq(source.id, brandEating!.id));
    expect(row!.consecutiveFailures).toBe(0);
    expect(row!.lastSuccessAt).not.toBeNull();
    expect(row!.httpEtag).toBe('"abc"');
  });

  it('updateSourceHealth increments consecutiveFailures and leaves lastSuccessAt untouched on failure', async () => {
    const db = getTestDb();
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    await updateSourceHealth(db, prNewswire!.id, {
      lastAttemptAt: new Date(),
      lastSuccessAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
      httpEtag: null,
      httpLastModified: null,
    });
    const [beforeFailure] = await db.select().from(source).where(eq(source.id, prNewswire!.id));

    await updateSourceHealth(db, prNewswire!.id, {
      lastAttemptAt: new Date(),
      lastSuccessAt: null,
      consecutiveFailures: 1,
      lastError: 'timeout',
      httpEtag: null,
      httpLastModified: null,
    });
    const [afterFailure] = await db.select().from(source).where(eq(source.id, prNewswire!.id));

    expect(afterFailure!.consecutiveFailures).toBe(1);
    expect(afterFailure!.lastError).toBe('timeout');
    expect(afterFailure!.lastSuccessAt).toEqual(beforeFailure!.lastSuccessAt);
  });
});
