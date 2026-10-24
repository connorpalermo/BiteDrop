import { createHash } from 'node:crypto';
import { normalizeName, type FoodDropExtraction } from '@bitedrop/core';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createFoodDropFromExtraction,
  listCategoryIds,
} from '../src/repositories/extractRepository';
import { findDedupeMatch, linkRawItemToFoodDrop } from '../src/repositories/dedupeRepository';
import { listIngestSources } from '../src/repositories/sourceRepository';
import { brand, foodDrop, foodDropSource, rawItem } from '../src/schema/index';
import { getTestDb, resetTestDb } from './testDb';

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

function hashContent(text: string): Buffer {
  return createHash('sha256').update(text).digest();
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

interface CandidateInput {
  sourceId: string;
  url: string;
  contentHash?: Buffer | null;
  discoveredAt?: Date;
}

async function insertCandidate(input: CandidateInput) {
  const db = getTestDb();
  const discoveredAt = input.discoveredAt ?? new Date('2026-10-24T00:00:00.000Z');
  const [row] = await db
    .insert(rawItem)
    .values({
      sourceId: input.sourceId,
      url: input.url,
      urlHash: hashUrl(input.url),
      contentHash: input.contentHash ?? null,
      discoveredAt,
      stage: 'candidate',
    })
    .returning({ id: rawItem.id, urlHash: rawItem.urlHash, contentHash: rawItem.contentHash });

  return {
    id: row!.id,
    title: null,
    excerpt: null,
    bodyText: null,
    discoveredAt: discoveredAt.toISOString(),
    urlHash: row!.urlHash,
    contentHash: row!.contentHash,
    sourceId: input.sourceId,
    sourceTrustTier: 2,
  };
}

async function insertBrand(name: string): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .insert(brand)
    .values({
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      normalizedName: normalizeName(name),
    })
    .returning({ id: brand.id });
  return row!.id;
}

describe('dedupeRepository.findDedupeMatch', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('Layer 1: an identical canonical URL from a different source matches via exact_url', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/l1',
    });
    await createFoodDropFromExtraction(db, first, extraction({ name: 'Layer1 Drop' }), {
      brandId: null,
      categoryId: categoryIds.get('other')!,
    });

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/l1',
    });
    const match = await findDedupeMatch(db, second, extraction({ name: 'Layer1 Drop' }), null);

    expect(match).not.toBeNull();
    expect(match!.linkMethod).toBe('exact_url');
    expect(match!.linkConfidence).toBe(1);
  });

  it('Layer 2: identical content_hash under a different URL matches via content_hash', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);
    const contentHash = hashContent('same syndicated body text');

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/l2-a',
      contentHash,
    });
    await createFoodDropFromExtraction(db, first, extraction({ name: 'Layer2 Drop' }), {
      brandId: null,
      categoryId: categoryIds.get('other')!,
    });

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/l2-b',
      contentHash,
    });
    const match = await findDedupeMatch(db, second, extraction({ name: 'Layer2 Drop' }), null);

    expect(match?.linkMethod).toBe('content_hash');
  });

  it('Layer 3: same brand, exact normalised name, matches via name_brand', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);
    const brandId = await insertBrand('Layer3 Test Brand');

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/l3-a',
    });
    await createFoodDropFromExtraction(db, first, extraction({ name: 'Spicy Sauce Deluxe' }), {
      brandId,
      categoryId: categoryIds.get('other')!,
    });

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/l3-b',
    });
    const match = await findDedupeMatch(
      db,
      second,
      extraction({ name: 'Spicy Sauce Deluxe' }),
      brandId,
    );

    expect(match?.linkMethod).toBe('name_brand');
    expect(match?.linkConfidence).toBe(0.9);
  });

  it('Layer 4: same brand, similar (not identical) name, within 14 days, matches via fuzzy', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);
    const brandId = await insertBrand('Layer4 Test Brand');
    const baseDate = new Date('2026-10-24T00:00:00.000Z');

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/l4-a',
      discoveredAt: baseDate,
    });
    await createFoodDropFromExtraction(db, first, extraction({ name: 'Fiery Mango Salsa' }), {
      brandId,
      categoryId: categoryIds.get('other')!,
    });

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/l4-b',
      discoveredAt: new Date(baseDate.getTime() + 5 * 24 * 60 * 60 * 1000),
    });
    const match = await findDedupeMatch(
      db,
      second,
      extraction({ name: 'Fiery Mango Salsa Deluxe' }),
      brandId,
    );

    expect(match?.linkMethod).toBe('fuzzy');
  });

  it('Layer 4 negative: the identical fuzzy pair outside the 14-day window does not match', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);
    const brandId = await insertBrand('Layer4 Negative Brand');
    const baseDate = new Date('2026-10-24T00:00:00.000Z');

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/l4neg-a',
      discoveredAt: baseDate,
    });
    await createFoodDropFromExtraction(db, first, extraction({ name: 'Smoky BBQ Ribs' }), {
      brandId,
      categoryId: categoryIds.get('other')!,
    });

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/l4neg-b',
      discoveredAt: new Date(baseDate.getTime() + 20 * 24 * 60 * 60 * 1000),
    });
    const match = await findDedupeMatch(
      db,
      second,
      extraction({ name: 'Smoky BBQ Ribs Deluxe' }),
      brandId,
    );

    expect(match).toBeNull();
  });

  it('no brand_id skips Layers 3/4 even when an identical-name drop exists with a different brand', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);
    const brandId = await insertBrand('Unrelated Brand');

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/nobrand-a',
    });
    await createFoodDropFromExtraction(db, first, extraction({ name: 'Mystery Snack' }), {
      brandId,
      categoryId: categoryIds.get('other')!,
    });

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/nobrand-b',
    });
    const match = await findDedupeMatch(db, second, extraction({ name: 'Mystery Snack' }), null);

    expect(match).toBeNull();
  });
});

describe('dedupeRepository.linkRawItemToFoodDrop', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('increments source_count, advances last_source_at, raises confidence, and never lowers it or touches descriptive fields', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);
    const baseDate = new Date('2026-10-24T00:00:00.000Z');

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/link-a',
      discoveredAt: baseDate,
    });
    await createFoodDropFromExtraction(
      db,
      first,
      extraction({ name: 'Corroboration Test Drop', confidence: 0.5 }),
      { brandId: null, categoryId: categoryIds.get('other')! },
    );
    const [before] = await db
      .select()
      .from(foodDrop)
      .where(eq(foodDrop.name, 'Corroboration Test Drop'));
    expect(before!.published).toBe(false); // 0.5 < 0.6 threshold

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/link-b',
      discoveredAt: new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000),
    });
    await linkRawItemToFoodDrop(
      db,
      second,
      { foodDropId: before!.id, linkMethod: 'exact_url', linkConfidence: 1.0 },
      extraction({ name: 'Should Be Ignored', confidence: 0.65 }),
    );

    const [after] = await db.select().from(foodDrop).where(eq(foodDrop.id, before!.id));
    expect(after!.sourceCount).toBe(2);
    expect(after!.confidence).toBe(0.65);
    expect(after!.published).toBe(true); // corroboration pushed it over 0.6
    expect(after!.name).toBe('Corroboration Test Drop'); // never overwritten
    expect(after!.lastSourceAt!.getTime()).toBeGreaterThan(before!.lastSourceAt!.getTime());

    const sources = await db
      .select()
      .from(foodDropSource)
      .where(eq(foodDropSource.foodDropId, before!.id));
    expect(sources).toHaveLength(2);
    expect(sources.find((s) => s.rawItemId === second.id)?.role).toBe('corroborating');

    const [linkedRawItem] = await db.select().from(rawItem).where(eq(rawItem.id, second.id));
    expect(linkedRawItem!.stage).toBe('linked');
  });

  it('confidence never decreases even if the second source scores lower', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const [prNewswire] = await listIngestSources(db, 'prnewswire-rss');
    const categoryIds = await listCategoryIds(db);

    const first = await insertCandidate({
      sourceId: brandEating!.id,
      url: 'https://example.com/noLower-a',
    });
    await createFoodDropFromExtraction(
      db,
      first,
      extraction({ name: 'High Confidence Drop', confidence: 0.9 }),
      {
        brandId: null,
        categoryId: categoryIds.get('other')!,
      },
    );
    const [before] = await db
      .select()
      .from(foodDrop)
      .where(eq(foodDrop.name, 'High Confidence Drop'));

    const second = await insertCandidate({
      sourceId: prNewswire!.id,
      url: 'https://example.com/noLower-b',
    });
    await linkRawItemToFoodDrop(
      db,
      second,
      { foodDropId: before!.id, linkMethod: 'exact_url', linkConfidence: 1.0 },
      extraction({ name: 'Weaker Second Extraction', confidence: 0.4 }),
    );

    const [after] = await db.select().from(foodDrop).where(eq(foodDrop.id, before!.id));
    expect(after!.confidence).toBe(0.9);
  });
});
