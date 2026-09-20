import { and, eq, isNull, type SQL } from 'drizzle-orm';
import {
  findCategory,
  type DropStatus,
  type FoodDropSummary,
  type SourceRef,
} from '@bitedrop/core';
import { brand, category, foodDrop } from '../schema/index';
import type { ChildData } from './childLoaders';

/**
 * The base predicate every query in this repository carries, without
 * exception: unpublished drops and tombstones are never visible through the
 * repository interface.
 */
export function baseFeedWhere(): SQL {
  return and(eq(foodDrop.published, true), isNull(foodDrop.mergedIntoId))!;
}

/** The columns every FoodDropSummary needs, shared by list() and getBySlug()
 * (both the main row and its related drops). `category`/`brand` must already
 * be joined in by the caller. */
export const summaryColumns = {
  id: foodDrop.id,
  slug: foodDrop.slug,
  name: foodDrop.name,
  categorySlug: category.slug,
  brandSlug: brand.slug,
  brandName: brand.name,
  subcategory: foodDrop.subcategory,
  shortDescription: foodDrop.shortDescription,
  status: foodDrop.status,
  isLimitedTime: foodDrop.isLimitedTime,
  releaseDate: foodDrop.releaseDate,
  availabilityStart: foodDrop.availabilityStart,
  availabilityEnd: foodDrop.availabilityEnd,
  priceCents: foodDrop.priceCents,
  priceCurrency: foodDrop.priceCurrency,
  imageUrl: foodDrop.imageUrl,
  sourceCount: foodDrop.sourceCount,
  firstSeenAt: foodDrop.firstSeenAt,
  trendingScore: foodDrop.trendingScore,
};

export interface SummaryRow {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  brandSlug: string | null;
  brandName: string | null;
  subcategory: string | null;
  shortDescription: string;
  status: DropStatus;
  isLimitedTime: boolean;
  releaseDate: string | null;
  availabilityStart: string | null;
  availabilityEnd: string | null;
  priceCents: number | null;
  priceCurrency: string | null;
  imageUrl: string | null;
  sourceCount: number;
  firstSeenAt: Date;
  trendingScore: number;
}

/** `firstSeenAt` is the one timestamptz column on a summary, converted to an
 * ISO string here — everywhere else is already the right JS type by
 * construction (date columns are declared `mode: 'string'` in the schema). */
export function toSummary(row: SummaryRow, children: ChildData): FoodDropSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brandSlug && row.brandName ? { slug: row.brandSlug, name: row.brandName } : null,
    category: findCategory(row.categorySlug),
    subcategory: row.subcategory,
    shortDescription: row.shortDescription,
    status: row.status,
    isLimitedTime: row.isLimitedTime,
    releaseDate: row.releaseDate,
    availabilityStart: row.availabilityStart,
    availabilityEnd: row.availabilityEnd,
    priceCents: row.priceCents,
    priceCurrency: row.priceCurrency,
    imageUrl: row.imageUrl,
    countries: children.countriesByDropId.get(row.id) ?? [],
    retailers: children.retailersByDropId.get(row.id) ?? [],
    sourceCount: row.sourceCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    trendingScore: row.trendingScore,
  };
}

export interface SourceRow {
  id: string;
  sourceName: string;
  title: string | null;
  url: string;
  publishedAt: Date | null;
  discoveredAt: Date;
  role: 'primary' | 'corroborating';
}

/** raw_item.title is nullable at the schema level (a raw discovery may
 * genuinely lack one before extraction), but a row that has been linked into
 * a food_drop as a SourceRef is expected to carry one — a broken invariant,
 * not a value to paper over with a fallback string. */
function requireTitle(title: string | null, rawItemId: string): string {
  if (title === null) throw new Error(`raw_item ${rawItemId} linked as a source has no title`);
  return title;
}

export function toSourceRef(row: SourceRow): SourceRef {
  return {
    id: row.id,
    sourceName: row.sourceName,
    title: requireTitle(row.title, row.id),
    url: row.url,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    discoveredAt: row.discoveredAt.toISOString(),
    isPrimary: row.role === 'primary',
  };
}
