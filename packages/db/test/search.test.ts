import { beforeAll, describe, expect, it } from 'vitest';
import { PgFoodDropRepository } from '../src/repositories/foodDropRepository';
import { getTestDb, resetTestDb } from './testDb';

describe('PgFoodDropRepository.list — search', () => {
  const db = getTestDb();
  const repo = new PgFoodDropRepository(db);

  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('matches the product name', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: 'Oreo' });
    expect(page.items.some((i) => i.name.includes('Oreo'))).toBe(true);
  });

  it('matches the brand name', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: "Wendy's" });
    expect(page.items.some((i) => i.brand?.name === "Wendy's")).toBe(true);
  });

  it('matches the description', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: 'poutine' });
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('prefix-matches the last token (search-as-you-type)', async () => {
    const page = await repo.list({ limit: 100, sort: 'newest', search: 'pick' });
    expect(page.items.some((i) => i.slug === 'harvest-farms-pickle-chips')).toBe(true);
  });

  it('is AND across multiple tokens, not OR', async () => {
    const single = await repo.list({ limit: 100, sort: 'newest', search: 'taco' });
    const combined = await repo.list({ limit: 100, sort: 'newest', search: 'taco jalapeno' });
    expect(combined.items.length).toBeLessThanOrEqual(single.items.length);
    expect(combined.items.length).toBeGreaterThan(0);
  });

  it('is case-insensitive', async () => {
    const lower = await repo.list({ limit: 100, sort: 'newest', search: 'oreo' });
    const upper = await repo.list({ limit: 100, sort: 'newest', search: 'OREO' });
    expect(lower.items.map((i) => i.id)).toEqual(upper.items.map((i) => i.id));
    expect(lower.items.length).toBeGreaterThan(0);
  });

  it('is diacritic-insensitive in both directions', async () => {
    // The Oreo drop's description contains "creme" — a plain-ascii query
    // must find it, and the accented spelling must find the same result.
    const plain = await repo.list({ limit: 100, sort: 'newest', search: 'creme' });
    const accented = await repo.list({ limit: 100, sort: 'newest', search: 'crème' });
    expect(plain.items.map((i) => i.id)).toEqual(accented.items.map((i) => i.id));
  });

  it('tolerates a one-character typo via the word_similarity trigram fallback', async () => {
    // Whole-string similarity() would score this well under the 0.3
    // threshold ("oreoo" vs the full multi-word "oreo caramel apple" name) —
    // this is the word_similarity() fix's regression coverage.
    const exact = await repo.list({ limit: 100, sort: 'newest', search: 'Oreo' });
    const typo = await repo.list({ limit: 100, sort: 'newest', search: 'Oreoo' });
    expect(exact.items.length).toBeGreaterThan(0);
    expect(typo.items.map((i) => i.id)).toEqual(exact.items.map((i) => i.id));
  });

  it('treats an empty or whitespace-only search as no filter', async () => {
    const all = await repo.list({ limit: 100, sort: 'newest' });
    const empty = await repo.list({ limit: 100, sort: 'newest', search: '' });
    const whitespace = await repo.list({ limit: 100, sort: 'newest', search: '   ' });
    expect(empty.items.length).toBe(all.items.length);
    expect(whitespace.items.length).toBe(all.items.length);
  });
});
