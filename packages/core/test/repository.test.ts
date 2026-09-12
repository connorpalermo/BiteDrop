import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, InvalidCursorError } from '../src/repository';
import type { FeedQuery } from '../src/repository';
import { RAW_MOCK_DROPS } from '../src/mock/data';
import { MockFoodDropRepository } from '../src/mock/repository';
import type { RawMockDrop } from '../src/mock/data';

const NEWEST_QUERY: FeedQuery = { limit: PAGE_SIZE, sort: 'newest' };

function makeRaw(overrides: Partial<RawMockDrop> & Pick<RawMockDrop, 'id' | 'slug'>): RawMockDrop {
  return {
    name: overrides.name ?? `Fixture ${overrides.id}`,
    brand: null,
    categorySlug: 'other',
    subcategory: null,
    shortDescription: 'A fixture drop.',
    description: 'A fixture drop used only in tests.',
    status: 'new',
    isLimitedTime: false,
    releaseDate: null,
    availabilityStart: null,
    availabilityEnd: null,
    priceCents: null,
    priceCurrency: null,
    imageUrl: null,
    countryCodes: ['US'],
    retailerSlugs: [],
    sourceCount: 1,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    trendingScore: 0,
    confidence: 0.5,
    ...overrides,
  };
}

describe('MockFoodDropRepository.list — pagination', () => {
  const repo = new MockFoodDropRepository();

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

    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen.length).toBe(RAW_MOCK_DROPS.length); // no gaps, full coverage
    expect(lastPageWasFull).toBe(false); // 40 items / 12 per page -> last page is partial
  });

  it('sets nextCursor to null exactly on the final page', async () => {
    // 40 items, PAGE_SIZE 12 -> pages of 12, 12, 12, 4
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

  it('breaks ties on the primary sort value deterministically by id descending', async () => {
    const tied = new MockFoodDropRepository([
      makeRaw({ id: 'b', slug: 'b', firstSeenAt: '2026-01-01T00:00:00.000Z' }),
      makeRaw({ id: 'a', slug: 'a', firstSeenAt: '2026-01-01T00:00:00.000Z' }),
      makeRaw({ id: 'c', slug: 'c', firstSeenAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    const page = await tied.list({ limit: 10, sort: 'newest' });
    expect(page.items.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('MockFoodDropRepository.list — filtering', () => {
  const repo = new MockFoodDropRepository();

  it('narrows by a single category', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', categories: ['candy'] });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.category.slug === 'candy')).toBe(true);
  });

  it('narrows by a single country', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', countries: ['JP'] });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.countries.some((c) => c.code === 'JP'))).toBe(true);
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

  it('treats two values within one facet as OR', async () => {
    const candy = await repo.list({ limit: 100, sort: 'newest', categories: ['candy'] });
    const chips = await repo.list({ limit: 100, sort: 'newest', categories: ['chips'] });
    const both = await repo.list({ limit: 100, sort: 'newest', categories: ['candy', 'chips'] });
    expect(both.items.length).toBe(candy.items.length + chips.items.length);
  });

  it('treats two different facets as AND', async () => {
    const category = await repo.list({ limit: 100, sort: 'newest', categories: ['candy'] });
    const combined = await repo.list({
      limit: 100,
      sort: 'newest',
      categories: ['candy'],
      countries: ['JP'],
    });
    expect(combined.items.length).toBeGreaterThan(0);
    expect(combined.items.length).toBeLessThanOrEqual(category.items.length);
    expect(
      combined.items.every(
        (i) => i.category.slug === 'candy' && i.countries.some((c) => c.code === 'JP'),
      ),
    ).toBe(true);
  });

  it('matches search against the product name', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: 'Oreo' });
    expect(page.items.some((i) => i.name.includes('Oreo'))).toBe(true);
  });

  it('matches search against the brand name', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: "Wendy's" });
    expect(page.items.some((i) => i.brand?.name === "Wendy's")).toBe(true);
  });

  it('matches search against the short description', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: 'poutine' });
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('is case-insensitive', async () => {
    const lower = await repo.list({ limit: 100, sort: 'newest', search: 'oreo' });
    const upper = await repo.list({ limit: 100, sort: 'newest', search: 'OREO' });
    expect(lower.items.map((i) => i.id)).toEqual(upper.items.map((i) => i.id));
    expect(lower.items.length).toBeGreaterThan(0);
  });

  it('is diacritic-insensitive', async () => {
    const withDiacritic = new MockFoodDropRepository([
      makeRaw({ id: 'x', slug: 'x', name: 'Café Frappé Bar' }),
    ]);
    const page = await withDiacritic.list({ limit: 10, sort: 'newest', search: 'cafe frappe' });
    expect(page.items).toHaveLength(1);
  });

  it('treats an empty or whitespace-only search as no filter', async () => {
    const all = await repo.list({ limit: 100, sort: 'newest' });
    const empty = await repo.list({ limit: 100, sort: 'newest', search: '' });
    const whitespace = await repo.list({ limit: 100, sort: 'newest', search: '   ' });
    expect(empty.items.length).toBe(all.items.length);
    expect(whitespace.items.length).toBe(all.items.length);
  });
});

describe('MockFoodDropRepository.list — sorting', () => {
  it('orders by trendingScore descending when sort is trending', async () => {
    const repo = new MockFoodDropRepository();
    const page = await repo.list({ limit: 100, sort: 'trending' });
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i - 1]!.trendingScore >= page.items[i]!.trendingScore).toBe(true);
    }
  });
});

describe('MockFoodDropRepository.getBySlug', () => {
  const repo = new MockFoodDropRepository();

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
    expect(detail!.relatedBySameBrand.some((r) => r.id === raw.id)).toBe(false);
    expect(detail!.relatedBySameCategory.some((r) => r.id === raw.id)).toBe(false);
  });
});

describe('MockFoodDropRepository.facets', () => {
  const repo = new MockFoodDropRepository();

  it('category counts sum to the total number of drops', async () => {
    const facets = await repo.facets();
    const sum = facets.categories.reduce((acc, c) => acc + c.count, 0);
    expect(sum).toBe(RAW_MOCK_DROPS.length);
  });

  it('status counts sum to the total number of drops', async () => {
    const facets = await repo.facets();
    const sum = facets.statuses.reduce((acc, s) => acc + s.count, 0);
    expect(sum).toBe(RAW_MOCK_DROPS.length);
  });

  it('brand facets are sorted by count descending, then label ascending', async () => {
    const facets = await repo.facets();
    for (let i = 1; i < facets.brands.length; i++) {
      const prev = facets.brands[i - 1]!;
      const curr = facets.brands[i]!;
      const orderedCorrectly =
        prev.count > curr.count || (prev.count === curr.count && prev.label <= curr.label);
      expect(orderedCorrectly).toBe(true);
    }
  });

  it('is unaffected by any query filters', async () => {
    const unfiltered = await repo.facets();
    // facets() takes no arguments — this test documents that the same 40-item
    // dataset always yields the same totals regardless of any prior list() call.
    await repo.list({ limit: 5, sort: 'newest', categories: ['candy'] });
    const afterFiltering = await repo.facets();
    expect(afterFiltering).toEqual(unfiltered);
  });
});
