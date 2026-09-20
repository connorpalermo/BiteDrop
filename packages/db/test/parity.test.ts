import type { FeedQuery, FoodDropSummary } from '@bitedrop/core';
import { MockFoodDropRepository } from '@bitedrop/core/mock';
import { beforeAll, describe, expect, it } from 'vitest';
import { PgFoodDropRepository } from '../src/repositories/foodDropRepository';
import { getTestDb, resetTestDb } from './testDb';

/**
 * `trendingScore` has real duplicate values in the mock dataset, so the id
 * tiebreak legitimately diverges between the two repositories — the mock's
 * RawMockDrop.id strings and Postgres's random UUIDs are unrelated id
 * spaces, so which of a tied pair sorts first is arbitrary. `newest` has no
 * such case (every firstSeenAt in the mock is unique), so a strict order
 * comparison stays valid everywhere except `sort: 'trending'`.
 */
function groupedByTrendingScore(items: FoodDropSummary[]): Set<string>[] {
  const groups: Set<string>[] = [];
  let prevScore: number | undefined;
  for (const item of items) {
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && prevScore === item.trendingScore) {
      currentGroup.add(item.slug);
    } else {
      groups.push(new Set([item.slug]));
    }
    prevScore = item.trendingScore;
  }
  return groups;
}

/**
 * Runs the same FeedQuery through both repositories and asserts identical
 * results — the strongest guarantee that the Postgres-backed feed behaves
 * the same as the mock-backed one did.
 *
 * `search: 'Oreo'` is a full-word match on purpose, not a mid-word
 * substring — the mock matches by plain substring, Postgres by FTS token,
 * and those genuinely diverge on a mid-word fragment (e.g. "ickle" matches
 * `String.includes` but not FTS). That divergence is real and intentional
 * (see feedQuery.ts's searchFilter and search.test.ts), so the case here
 * stays on ground where both mechanisms agree.
 */
const CASES: Record<string, Omit<FeedQuery, 'limit'>> = {
  default: { sort: 'newest' },
  'single facet — category': { sort: 'newest', categories: ['candy'] },
  'single facet — country': { sort: 'newest', countries: ['JP'] },
  'single facet — status': { sort: 'newest', statuses: ['rumored'] },
  'single facet — brand': { sort: 'newest', brandSlugs: ['oreo'] },
  'two facets combined': { sort: 'newest', categories: ['candy'], countries: ['JP'] },
  'search (full-word)': { sort: 'newest', search: 'Oreo' },
  trending: { sort: 'trending' },
};

describe('parity — mock vs Postgres return identical results', () => {
  const mock = new MockFoodDropRepository();
  let pg: PgFoodDropRepository;

  beforeAll(async () => {
    await resetTestDb();
    pg = new PgFoodDropRepository(getTestDb());
  }, 30_000);

  for (const [label, partial] of Object.entries(CASES)) {
    it(`${label}: identical results`, async () => {
      const query: FeedQuery = { limit: 100, ...partial };
      const mockPage = await mock.list(query);
      const pgPage = await pg.list(query);

      if (query.sort === 'trending') {
        expect(groupedByTrendingScore(pgPage.items)).toEqual(
          groupedByTrendingScore(mockPage.items),
        );
      } else {
        expect(pgPage.items.map((i) => i.slug)).toEqual(mockPage.items.map((i) => i.slug));
      }
    });
  }
});
