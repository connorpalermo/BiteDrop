import { CATEGORIES, COUNTRIES, STATUSES } from '@bitedrop/core';
import { RAW_MOCK_DROPS } from '@bitedrop/core/mock';
import { beforeAll, describe, expect, it } from 'vitest';
import { PgFoodDropRepository } from '../src/repositories/foodDropRepository';
import { getTestDb, resetTestDb } from './testDb';

describe('PgFoodDropRepository.facets', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('includes all 11 categories, 9 countries, and 6 statuses, including zero counts', async () => {
    const facets = await repo.facets();
    expect(facets.categories).toHaveLength(CATEGORIES.length);
    expect(facets.countries).toHaveLength(COUNTRIES.length);
    expect(facets.statuses).toHaveLength(STATUSES.length);
  });

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

  it('country counts sum to at least the total number of drops (multi-country drops count once per country)', async () => {
    const facets = await repo.facets();
    const sum = facets.countries.reduce((acc, c) => acc + c.count, 0);
    expect(sum).toBeGreaterThanOrEqual(RAW_MOCK_DROPS.length);
  });

  it('brands include only present brands, ordered by count desc then name asc', async () => {
    const facets = await repo.facets();
    expect(facets.brands.length).toBeGreaterThan(0);
    expect(facets.brands.every((b) => b.count > 0)).toBe(true);
    for (let i = 1; i < facets.brands.length; i++) {
      const prev = facets.brands[i - 1]!;
      const curr = facets.brands[i]!;
      const orderedCorrectly =
        prev.count > curr.count || (prev.count === curr.count && prev.label <= curr.label);
      expect(orderedCorrectly).toBe(true);
    }
  });

  it('is unaffected by a preceding list() query with filters', async () => {
    const unfiltered = await repo.facets();
    await repo.list({ limit: 5, sort: 'newest', categories: ['candy'] });
    const afterFiltering = await repo.facets();
    expect(afterFiltering).toEqual(unfiltered);
  });
});
