import { InvalidCursorError, PAGE_SIZE, type FeedQuery } from '@bitedrop/core';
import { RAW_MOCK_DROPS } from '@bitedrop/core/mock';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgFoodDropRepository } from '../src/repositories/foodDropRepository';
import { category, foodDrop } from '../src/schema/index';
import { getTestDb, resetTestDb } from './testDb';

const NEWEST_QUERY: FeedQuery = { limit: PAGE_SIZE, sort: 'newest' };

describe('PgFoodDropRepository.list — pagination', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('returns PAGE_SIZE items by default, newest first', async () => {
    const page = await repo.list(NEWEST_QUERY);
    expect(page.items).toHaveLength(PAGE_SIZE);
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i - 1]!.firstSeenAt >= page.items[i]!.firstSeenAt).toBe(true);
    }
  });

  it('pages to the end with no duplicates, no gaps, and full coverage', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let lastPageWasFull = true;

    for (let guard = 0; guard < 20; guard++) {
      const page = await repo.list({ ...NEWEST_QUERY, cursor });
      seen.push(...page.items.map((i) => i.id));
      lastPageWasFull = page.items.length === PAGE_SIZE;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(RAW_MOCK_DROPS.length);
    expect(lastPageWasFull).toBe(false);
  });

  it('sets nextCursor to null exactly on the final page', async () => {
    const p1 = await repo.list({ ...NEWEST_QUERY });
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await repo.list({ ...NEWEST_QUERY, cursor: p1.nextCursor! });
    expect(p2.nextCursor).not.toBeNull();
    const p3 = await repo.list({ ...NEWEST_QUERY, cursor: p2.nextCursor! });
    expect(p3.nextCursor).not.toBeNull();
    const p4 = await repo.list({ ...NEWEST_QUERY, cursor: p3.nextCursor! });
    expect(p4.items).toHaveLength(4);
    expect(p4.nextCursor).toBeNull();
  });

  it('throws InvalidCursorError on a malformed cursor', async () => {
    await expect(repo.list({ ...NEWEST_QUERY, cursor: 'not-a-real-cursor' })).rejects.toThrow(
      InvalidCursorError,
    );
  });
});

describe('PgFoodDropRepository.list — tie-break on the primary sort value', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);
  const tiedIds: string[] = [];
  // Far in the future relative to any seeded value, so these three rows sort
  // as the newest three under `sort: 'newest'` and the id tiebreak is the
  // only thing left to determine their relative order.
  const tiedAt = '2099-01-01T00:00:00.000Z';

  beforeAll(async () => {
    await resetTestDb();
    const [otherCategory] = await db.select({ id: category.id }).from(category).limit(1);
    for (const suffix of ['tie-b', 'tie-a', 'tie-c']) {
      const [row] = await db
        .insert(foodDrop)
        .values({
          slug: `zz-${suffix}`,
          name: `Tie fixture ${suffix}`,
          normalizedName: `tie fixture ${suffix}`,
          categoryId: otherCategory!.id,
          shortDescription: 'fixture',
          description: 'fixture',
          status: 'new',
          published: true,
          firstSeenAt: new Date(tiedAt),
          trendingScore: 0,
        })
        .returning({ id: foodDrop.id });
      tiedIds.push(row!.id);
    }
  }, 30_000);

  afterAll(async () => {
    for (const id of tiedIds) {
      await db.delete(foodDrop).where(eq(foodDrop.id, id));
    }
  });

  it('breaks ties on id descending, deterministically', async () => {
    const page = await repo.list({ limit: 3, sort: 'newest' });
    expect(page.items.map((i) => i.id)).toEqual([...tiedIds].sort().reverse());
  });
});

describe('PgFoodDropRepository.list — filtering', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('narrows by a single category', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', categories: ['candy'] });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.category.slug === 'candy')).toBe(true);
  });

  it('narrows by a single country, and a multi-country drop appears exactly once', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', countries: ['JP'] });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.countries.some((c) => c.code === 'JP'))).toBe(true);
    expect(new Set(page.items.map((i) => i.id)).size).toBe(page.items.length);
  });

  it('narrows by a single status', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', statuses: ['rumored'] });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.status === 'rumored')).toBe(true);
  });

  it('narrows by a single brand', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', brandSlugs: ['oreo'] });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.brand?.slug === 'oreo')).toBe(true);
  });

  it('treats two values within one facet (countries) as OR, with no double-count', async () => {
    const jp = await repo.list({ limit: 100, sort: 'newest', countries: ['JP'] });
    const kr = await repo.list({ limit: 100, sort: 'newest', countries: ['KR'] });
    const both = await repo.list({ limit: 100, sort: 'newest', countries: ['JP', 'KR'] });
    const union = new Set([...jp.items.map((i) => i.id), ...kr.items.map((i) => i.id)]);
    expect(new Set(both.items.map((i) => i.id))).toEqual(union);
  });

  it('treats two different facets as AND', async () => {
    const cat = await repo.list({ limit: 100, sort: 'newest', categories: ['candy'] });
    const combined = await repo.list({
      limit: 100,
      sort: 'newest',
      categories: ['candy'],
      countries: ['JP'],
    });
    expect(combined.items.length).toBeGreaterThan(0);
    expect(combined.items.length).toBeLessThanOrEqual(cat.items.length);
    expect(
      combined.items.every(
        (i) => i.category.slug === 'candy' && i.countries.some((c) => c.code === 'JP'),
      ),
    ).toBe(true);
  });
});

describe('PgFoodDropRepository.list — sorting', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('orders by trendingScore descending when sort is trending', async () => {
    const page = await repo.list({ limit: 100, sort: 'trending' });
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i - 1]!.trendingScore >= page.items[i]!.trendingScore).toBe(true);
    }
  });
});

describe('PgFoodDropRepository.getBySlug', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('returns null for an unknown slug', async () => {
    expect(await repo.getBySlug('does-not-exist')).toBeNull();
  });

  it('returns a detail record whose sources length matches sourceCount', async () => {
    const raw = RAW_MOCK_DROPS[0]!;
    const detail = await repo.getBySlug(raw.slug);
    expect(detail).not.toBeNull();
    expect(detail!.sources).toHaveLength(raw.sourceCount);
    expect(detail!.sourceCount).toBe(raw.sourceCount);
  });

  it('never includes the drop itself in its related lists', async () => {
    const raw = RAW_MOCK_DROPS.find((d) => d.brand !== null)!;
    const detail = await repo.getBySlug(raw.slug);
    expect(detail!.relatedBySameBrand.some((r) => r.id === detail!.id)).toBe(false);
    expect(detail!.relatedBySameCategory.some((r) => r.id === detail!.id)).toBe(false);
  });
});
