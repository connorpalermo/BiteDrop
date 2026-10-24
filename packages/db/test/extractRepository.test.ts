import { createHash } from 'node:crypto';
import type { FoodDropExtraction } from '@bitedrop/core';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createFoodDropFromExtraction,
  listCandidateRawItems,
  listCategoryIds,
  listKnownBrands,
  markRawItemFailed,
} from '../src/repositories/extractRepository';
import { listIngestSources } from '../src/repositories/sourceRepository';
import { foodDrop, foodDropSource, rawItem } from '../src/schema/index';
import { getTestDb, resetTestDb } from './testDb';

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

function extraction(overrides: Partial<FoodDropExtraction> = {}): FoodDropExtraction {
  return {
    name: 'New Spicy Sauce',
    brandName: null,
    categorySlug: 'other',
    subcategory: null,
    shortDescription: 'New Spicy Sauce',
    description: 'A new spicy sauce.',
    status: 'new',
    isLimitedTime: false,
    releaseDate: null,
    priceCents: null,
    priceCurrency: null,
    confidence: 0.7,
    ...overrides,
  };
}

describe('extractRepository', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('listCandidateRawItems joins source for trustTier and scopes by sourceId', async () => {
    const db = getTestDb();
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const url = 'https://example.com/candidate-1';
    const [inserted] = await db
      .insert(rawItem)
      .values({ sourceId: prNewswire!.id, url, urlHash: hashUrl(url), stage: 'candidate' })
      .returning({ id: rawItem.id });

    const candidates = await listCandidateRawItems(db, prNewswire!.id);
    const match = candidates.find((c) => c.id === inserted!.id);
    expect(match).toBeDefined();
    expect(match!.sourceTrustTier).toBe(1);
  });

  it('listKnownBrands returns the Phase 2 seeded brands with ids', async () => {
    const brands = await listKnownBrands(getTestDb());
    expect(brands.length).toBeGreaterThan(0);
    expect(brands[0]).toHaveProperty('id');
    expect(brands[0]).toHaveProperty('name');
  });

  it('listCategoryIds includes "other"', async () => {
    const ids = await listCategoryIds(getTestDb());
    expect(ids.get('other')).toBeTypeOf('number');
  });

  it('createFoodDropFromExtraction creates exactly one food_drop_source row, sets source_count=1, and links the raw_item', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const categoryIds = await listCategoryIds(db);
    const url = 'https://example.com/create-1';
    const [candidateRow] = await db
      .insert(rawItem)
      .values({
        sourceId: brandEating!.id,
        url,
        urlHash: hashUrl(url),
        discoveredAt: new Date('2026-10-24T00:00:00.000Z'),
        stage: 'candidate',
      })
      .returning({ id: rawItem.id, urlHash: rawItem.urlHash, discoveredAt: rawItem.discoveredAt });

    const candidate = {
      id: candidateRow!.id,
      title: null,
      excerpt: null,
      bodyText: null,
      discoveredAt: candidateRow!.discoveredAt.toISOString(),
      urlHash: candidateRow!.urlHash,
      contentHash: null,
      sourceId: brandEating!.id,
      sourceTrustTier: 2,
    };

    await createFoodDropFromExtraction(db, candidate, extraction(), {
      brandId: null,
      categoryId: categoryIds.get('other')!,
    });

    const [drop] = await db.select().from(foodDrop).where(eq(foodDrop.name, 'New Spicy Sauce'));
    expect(drop).toBeDefined();
    expect(drop!.sourceCount).toBe(1);

    const sources = await db
      .select()
      .from(foodDropSource)
      .where(eq(foodDropSource.foodDropId, drop!.id));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.linkMethod).toBe('exact_url');
    expect(sources[0]!.linkConfidence).toBe(1);

    const [linkedRawItem] = await db.select().from(rawItem).where(eq(rawItem.id, candidate.id));
    expect(linkedRawItem!.stage).toBe('linked');
  });

  it('published is true only when status is not rumored and confidence >= 0.6', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const categoryIds = await listCategoryIds(db);

    async function createAndRead(name: string, overrides: Partial<FoodDropExtraction>) {
      const url = `https://example.com/${name}`;
      const [row] = await db
        .insert(rawItem)
        .values({ sourceId: brandEating!.id, url, urlHash: hashUrl(url), stage: 'candidate' })
        .returning({
          id: rawItem.id,
          urlHash: rawItem.urlHash,
          discoveredAt: rawItem.discoveredAt,
        });
      const candidate = {
        id: row!.id,
        title: null,
        excerpt: null,
        bodyText: null,
        discoveredAt: row!.discoveredAt.toISOString(),
        urlHash: row!.urlHash,
        contentHash: null,
        sourceId: brandEating!.id,
        sourceTrustTier: 2,
      };
      await createFoodDropFromExtraction(db, candidate, extraction({ name, ...overrides }), {
        brandId: null,
        categoryId: categoryIds.get('other')!,
      });
      const [drop] = await db.select().from(foodDrop).where(eq(foodDrop.name, name));
      return drop!.published;
    }

    expect(await createAndRead('High confidence drop', { confidence: 0.8 })).toBe(true);
    expect(await createAndRead('Low confidence drop', { confidence: 0.3 })).toBe(false);
    expect(
      await createAndRead('Rumored high confidence drop', { confidence: 0.9, status: 'rumored' }),
    ).toBe(false);
  });

  it('markRawItemFailed sets stage=failed and increments attempt_count', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const url = 'https://example.com/fail-1';
    const [row] = await db
      .insert(rawItem)
      .values({ sourceId: brandEating!.id, url, urlHash: hashUrl(url), stage: 'candidate' })
      .returning({ id: rawItem.id });

    await markRawItemFailed(db, row!.id, 'boom');
    await markRawItemFailed(db, row!.id, 'boom again');

    const [after] = await db.select().from(rawItem).where(eq(rawItem.id, row!.id));
    expect(after!.stage).toBe('failed');
    expect(after!.lastError).toBe('boom again');
    expect(after!.attemptCount).toBe(2);
  });
});
