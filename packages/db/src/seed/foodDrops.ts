import { createHash } from 'node:crypto';
import { composeSearchText, findRetailer, normalizeName } from '@bitedrop/core';
import { RAW_MOCK_DROPS, sourcesFor, type RawMockDrop } from '@bitedrop/core/mock';
import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import {
  foodDrop,
  foodDropCountry,
  foodDropRetailer,
  foodDropSource,
  rawItem,
} from '../schema/index';

function mustGet<V>(map: Map<string, V>, key: string, kind: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed: no ${kind} found for key "${key}"`);
  return value;
}

/**
 * Every SourceRef the mock helper generates shares its publication's base
 * URL, which would violate raw_item's UNIQUE (source_id, url_hash) if
 * inserted as-is. Synthesises a unique, deterministic path per raw item
 * instead. These are placeholder URLs standing in for articles that don't
 * exist yet; real ingestion replaces them with real ones.
 */
function synthesizeUrl(dropSlug: string, index: number, baseUrl: string): string {
  return new URL(`${dropSlug}-${index}`, baseUrl).toString();
}

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

interface Lookups {
  categoryIds: Map<string, number>;
  brandIds: Map<string, string>;
  retailerIds: Map<string, number>;
  sourceIds: Map<string, string>;
}

async function insertFoodDropRow(
  db: Database,
  raw: RawMockDrop,
  { categoryIds, brandIds }: Lookups,
): Promise<string> {
  const [row] = await db
    .insert(foodDrop)
    .values({
      slug: raw.slug,
      name: raw.name,
      normalizedName: normalizeName(raw.name),
      brandId: raw.brand ? mustGet(brandIds, raw.brand.slug, 'brand') : null,
      categoryId: mustGet(categoryIds, raw.categorySlug, 'category'),
      subcategory: raw.subcategory,
      shortDescription: raw.shortDescription,
      description: raw.description,
      status: raw.status,
      isLimitedTime: raw.isLimitedTime,
      releaseDate: raw.releaseDate,
      availabilityStart: raw.availabilityStart,
      availabilityEnd: raw.availabilityEnd,
      priceCents: raw.priceCents,
      priceCurrency: raw.priceCurrency,
      imageUrl: raw.imageUrl,
      confidence: raw.confidence,
      published: true, // never omit — food_drop defaults to unpublished, so leaving this out silently produces an empty feed
      firstSeenAt: new Date(raw.firstSeenAt),
      trendingScore: raw.trendingScore,
      searchText: composeSearchText({
        name: raw.name,
        brandName: raw.brand?.name ?? null,
        subcategory: raw.subcategory,
        description: raw.description,
        retailerNames: raw.retailerSlugs.map((slug) => findRetailer(slug).name),
      }),
    })
    .returning({ id: foodDrop.id });
  return row!.id;
}

async function insertCountryRows(
  db: Database,
  foodDropId: string,
  raw: RawMockDrop,
): Promise<void> {
  await db.insert(foodDropCountry).values(
    raw.countryCodes.map((code, i) => ({
      foodDropId,
      countryCode: code,
      isPrimary: i === 0, // "ordered, primary first" — FoodDropSummary.countries
    })),
  );
}

async function insertRetailerRows(
  db: Database,
  foodDropId: string,
  raw: RawMockDrop,
  retailerIds: Map<string, number>,
): Promise<void> {
  if (raw.retailerSlugs.length === 0) return;
  await db.insert(foodDropRetailer).values(
    raw.retailerSlugs.map((slug) => ({
      foodDropId,
      retailerId: mustGet(retailerIds, slug, 'retailer'),
    })),
  );
}

async function insertSourceRows(
  db: Database,
  foodDropId: string,
  raw: RawMockDrop,
  sourceIds: Map<string, string>,
): Promise<void> {
  const refs = sourcesFor(raw);
  const urls = refs.map((ref, i) => synthesizeUrl(raw.slug, i, ref.url));

  const insertedRawItems = await db
    .insert(rawItem)
    .values(
      refs.map((ref, i) => ({
        sourceId: mustGet(sourceIds, ref.sourceName, 'source'),
        url: urls[i]!,
        urlHash: hashUrl(urls[i]!),
        title: ref.title,
        publishedAt: ref.publishedAt ? new Date(ref.publishedAt) : null,
        discoveredAt: new Date(ref.discoveredAt),
        stage: 'linked' as const,
      })),
    )
    .returning({ id: rawItem.id });

  await db.insert(foodDropSource).values(
    refs.map((ref, i) => ({
      foodDropId,
      rawItemId: insertedRawItems[i]!.id,
      sourceId: mustGet(sourceIds, ref.sourceName, 'source'),
      role: ref.isPrimary ? ('primary' as const) : ('corroborating' as const),
      linkMethod: 'manual' as const, // seeded rows were not matched by any algorithm
      linkConfidence: 1,
      linkedAt: new Date(ref.discoveredAt),
    })),
  );
}

/** source_count/last_source_at are denormalised for read performance, so
 * they must be backfilled from the join table actually populated above —
 * never copied from RawMockDrop.sourceCount directly. */
async function backfillSourceCounts(db: Database): Promise<void> {
  await db.execute(sql`
    UPDATE food_drop fd
    SET source_count = counts.cnt,
        last_source_at = counts.max_linked_at
    FROM (
      SELECT food_drop_id, count(*) AS cnt, max(linked_at) AS max_linked_at
      FROM food_drop_source
      GROUP BY food_drop_id
    ) counts
    WHERE counts.food_drop_id = fd.id
  `);
}

/** Catches a denormalised column silently disagreeing with its own join
 * table — a bug class that's otherwise easy to ship unnoticed. */
async function assertSourceCountsMatchMock(db: Database): Promise<void> {
  const rows = await db
    .select({ slug: foodDrop.slug, sourceCount: foodDrop.sourceCount })
    .from(foodDrop);
  const bySlug = new Map(rows.map((r) => [r.slug, r.sourceCount]));
  const mismatches = RAW_MOCK_DROPS.filter((raw) => bySlug.get(raw.slug) !== raw.sourceCount);
  if (mismatches.length > 0) {
    throw new Error(
      `Seed: source_count mismatch against mock data for: ${mismatches.map((d) => d.slug).join(', ')}`,
    );
  }
}

/** Seeds food_drop, food_drop_country, food_drop_retailer, raw_item, and
 * food_drop_source from RAW_MOCK_DROPS — one drop at a time so each drop's
 * own generated raw_item ids are available to link food_drop_source. */
export async function seedFoodDrops(db: Database, lookups: Lookups): Promise<void> {
  for (const raw of RAW_MOCK_DROPS) {
    const foodDropId = await insertFoodDropRow(db, raw, lookups);
    await insertCountryRows(db, foodDropId, raw);
    await insertRetailerRows(db, foodDropId, raw, lookups.retailerIds);
    await insertSourceRows(db, foodDropId, raw, lookups.sourceIds);
  }

  await backfillSourceCounts(db);
  await assertSourceCountsMatchMock(db);
}
