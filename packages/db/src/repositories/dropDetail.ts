import type { FoodDropDetail, FoodDropSummary, SourceRef } from '@bitedrop/core';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { brand, category, foodDrop, foodDropSource, rawItem, source } from '../schema/index';
import {
  baseFeedWhere,
  summaryColumns,
  toSourceRef,
  toSummary,
  type SummaryRow,
} from './rowMappers';
import { loadChildren } from './childLoaders';

interface MainRow extends SummaryRow {
  description: string;
  confidence: number;
}

async function fetchMainRow(db: Database, slug: string): Promise<MainRow | null> {
  const [row] = await db
    .select({
      ...summaryColumns,
      description: foodDrop.description,
      confidence: foodDrop.confidence,
    })
    .from(foodDrop)
    .innerJoin(category, eq(category.id, foodDrop.categoryId))
    .leftJoin(brand, eq(brand.id, foodDrop.brandId))
    .where(and(baseFeedWhere(), eq(foodDrop.slug, slug)))
    .limit(1);
  return row ?? null;
}

/** Up to 4, newest first, excluding the drop itself — shared shape for both
 * relatedBySameBrand and relatedBySameCategory. */
async function fetchRelated(
  db: Database,
  excludeId: string,
  matcher: ReturnType<typeof eq>,
): Promise<SummaryRow[]> {
  return db
    .select(summaryColumns)
    .from(foodDrop)
    .innerJoin(category, eq(category.id, foodDrop.categoryId))
    .leftJoin(brand, eq(brand.id, foodDrop.brandId))
    .where(and(baseFeedWhere(), ne(foodDrop.id, excludeId), matcher))
    .orderBy(desc(foodDrop.firstSeenAt))
    .limit(4);
}

/** Primary source first, then oldest-discovered first. */
async function fetchSources(db: Database, foodDropId: string): Promise<SourceRef[]> {
  const rows = await db
    .select({
      id: rawItem.id,
      sourceName: source.name,
      title: rawItem.title,
      url: rawItem.url,
      publishedAt: rawItem.publishedAt,
      discoveredAt: rawItem.discoveredAt,
      role: foodDropSource.role,
    })
    .from(foodDropSource)
    .innerJoin(rawItem, eq(rawItem.id, foodDropSource.rawItemId))
    .innerJoin(source, eq(source.id, foodDropSource.sourceId))
    .where(eq(foodDropSource.foodDropId, foodDropId))
    .orderBy(sql`(${foodDropSource.role} = 'primary') DESC`, asc(rawItem.discoveredAt));

  return rows.map(toSourceRef);
}

/** 6 queries, constant regardless of related-drop count: main row,
 * related-by-brand, related-by-category, batched countries, batched
 * retailers, sources. */
export async function getFoodDropDetail(
  db: Database,
  slug: string,
): Promise<FoodDropDetail | null> {
  const main = await fetchMainRow(db, slug);
  if (!main) return null;

  const [brandRelatedRows, categoryRelatedRows] = await Promise.all([
    main.brandSlug
      ? fetchRelated(db, main.id, eq(brand.slug, main.brandSlug))
      : Promise.resolve([]),
    fetchRelated(db, main.id, eq(category.slug, main.categorySlug)),
  ]);

  const allIds = [
    main.id,
    ...brandRelatedRows.map((r) => r.id),
    ...categoryRelatedRows.map((r) => r.id),
  ];
  const [children, sources] = await Promise.all([
    loadChildren(db, allIds),
    fetchSources(db, main.id),
  ]);

  const toRelated = (row: SummaryRow): FoodDropSummary => toSummary(row, children);

  return {
    ...toSummary(main, children),
    description: main.description,
    confidence: main.confidence,
    sources,
    relatedBySameBrand: brandRelatedRows.map(toRelated),
    relatedBySameCategory: categoryRelatedRows.map(toRelated),
  };
}
