import { foodDropDetailSchema, foodDropSummarySchema } from '@bitedrop/core';
import { RAW_MOCK_DROPS } from '@bitedrop/core/mock';
import { beforeAll, describe, expect, it } from 'vitest';
import { PgFoodDropRepository } from '../src/repositories/foodDropRepository';
import { getTestDb, resetTestDb } from './testDb';

describe('row shape', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('every list() item parses against foodDropSummarySchema', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest' });
    for (const item of page.items) {
      const result = foodDropSummarySchema.safeParse(item);
      expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(
        true,
      );
    }
  });

  it('getBySlug() parses against foodDropDetailSchema', async () => {
    const raw = RAW_MOCK_DROPS.find((d) => d.brand !== null)!;
    const detail = await repo.getBySlug(raw.slug);
    const result = foodDropDetailSchema.safeParse(detail);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it('firstSeenAt is an ISO string, not a Date — the timestamptz landmine', async () => {
    const page = await repo.list({ limit: 1, sort: 'newest' });
    expect(typeof page.items[0]!.firstSeenAt).toBe('string');
    expect(page.items[0]!.firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('releaseDate is a plain YYYY-MM-DD string, not a timezone-shifted Date — the date landmine', async () => {
    const withRelease = RAW_MOCK_DROPS.find((d) => d.releaseDate !== null)!;
    const detail = await repo.getBySlug(withRelease.slug);
    expect(detail!.releaseDate).toBe(withRelease.releaseDate);
    expect(detail!.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
