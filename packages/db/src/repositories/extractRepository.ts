import {
  composeSearchText,
  normalizeName,
  shouldPublish,
  type FoodDropExtraction,
} from '@bitedrop/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { brand, category, foodDrop, foodDropSource, rawItem, source } from '../schema/index';

export interface CandidateRawItem {
  id: string;
  title: string | null;
  excerpt: string | null;
  bodyText: string | null;
  discoveredAt: string; // ISO
  urlHash: Buffer;
  contentHash: Buffer | null;
  imageUrl: string | null;
  sourceId: string;
  sourceTrustTier: number;
}

export async function listCandidateRawItems(
  db: Database,
  sourceId?: string,
): Promise<CandidateRawItem[]> {
  const clauses = [eq(rawItem.stage, 'candidate')];
  if (sourceId) clauses.push(eq(rawItem.sourceId, sourceId));

  const rows = await db
    .select({
      id: rawItem.id,
      title: rawItem.title,
      excerpt: rawItem.excerpt,
      bodyText: rawItem.bodyText,
      discoveredAt: rawItem.discoveredAt,
      urlHash: rawItem.urlHash,
      contentHash: rawItem.contentHash,
      imageUrl: rawItem.imageUrl,
      sourceId: rawItem.sourceId,
      sourceTrustTier: source.trustTier,
    })
    .from(rawItem)
    .innerJoin(source, eq(source.id, rawItem.sourceId))
    .where(and(...clauses));

  return rows.map((row) => ({ ...row, discoveredAt: row.discoveredAt.toISOString() }));
}

export interface KnownBrand {
  id: string;
  name: string;
}

/** Fetched once per run: the heuristics need just the names to match
 * against; the orchestrator needs the id back to set food_drop.brand_id
 * once a name matches. */
export async function listKnownBrands(db: Database): Promise<KnownBrand[]> {
  return db.select({ id: brand.id, name: brand.name }).from(brand);
}

/** categorySlug -> category.id, fetched once per run rather than once per
 * candidate (the reference table is tiny and unchanging mid-run). */
export async function listCategoryIds(db: Database): Promise<Map<string, number>> {
  const rows = await db.select({ id: category.id, slug: category.slug }).from(category);
  return new Map(rows.map((row) => [row.slug, row.id]));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildFoodDropValues(
  candidate: CandidateRawItem,
  extraction: FoodDropExtraction,
  brandId: string | null,
  categoryId: number,
) {
  return {
    slug: `${slugify(extraction.name)}-${candidate.urlHash.toString('hex').slice(0, 6)}`,
    name: extraction.name,
    normalizedName: normalizeName(extraction.name),
    brandId,
    categoryId,
    subcategory: extraction.subcategory,
    shortDescription: extraction.shortDescription,
    description: extraction.description,
    imageUrl: candidate.imageUrl,
    status: extraction.status,
    isLimitedTime: extraction.isLimitedTime,
    releaseDate: extraction.releaseDate,
    priceCents: extraction.priceCents,
    priceCurrency: extraction.priceCurrency,
    confidence: extraction.confidence,
    published: shouldPublish(extraction.status, extraction.confidence),
    sourceCount: 1,
    firstSeenAt: new Date(candidate.discoveredAt),
    lastSourceAt: new Date(candidate.discoveredAt),
    searchText: composeSearchText({
      name: extraction.name,
      brandName: extraction.brandName,
      subcategory: extraction.subcategory,
      description: extraction.description,
      retailerNames: [],
    }),
  };
}

export interface FoodDropLink {
  brandId: string | null;
  categoryId: number;
}

/**
 * One transaction: insert food_drop, insert its one food_drop_source row,
 * set raw_item.stage = 'linked'. The slug is deterministic (derived from the
 * raw_item's own url_hash), not retry-on-conflict — stable if this stage is
 * ever re-run, with no conflict-and-retry loop needed.
 */
export async function createFoodDropFromExtraction(
  db: Database,
  candidate: CandidateRawItem,
  extraction: FoodDropExtraction,
  link: FoodDropLink,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [drop] = await tx
      .insert(foodDrop)
      .values(buildFoodDropValues(candidate, extraction, link.brandId, link.categoryId))
      .returning({ id: foodDrop.id });

    await tx.insert(foodDropSource).values({
      foodDropId: drop!.id,
      rawItemId: candidate.id,
      sourceId: candidate.sourceId,
      role: 'primary',
      linkMethod: 'exact_url',
      linkConfidence: 1.0,
    });

    await tx.update(rawItem).set({ stage: 'linked' }).where(eq(rawItem.id, candidate.id));
  });
}

export async function markRawItemFailed(
  db: Database,
  rawItemId: string,
  message: string,
): Promise<void> {
  await db
    .update(rawItem)
    .set({ stage: 'failed', lastError: message, attemptCount: sql`${rawItem.attemptCount} + 1` })
    .where(eq(rawItem.id, rawItemId));
}
