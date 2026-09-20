import {
  buildFacetCounts,
  CATEGORIES,
  COUNTRIES,
  STATUSES,
  findStatusLabel,
  type Facets,
} from '@bitedrop/core';
import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { brand, category, foodDrop, foodDropCountry } from '../schema/index';
import { baseFeedWhere } from './rowMappers';

/** Counts are over the entire published, non-tombstoned set and unaffected by
 * the current query, so the sidebar counts do not shift as filters are applied. */
async function categoryCounts(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ slug: category.slug, n: count() })
    .from(foodDrop)
    .innerJoin(category, eq(category.id, foodDrop.categoryId))
    .where(baseFeedWhere())
    .groupBy(category.slug);
  return new Map(rows.map((r) => [r.slug, r.n]));
}

/** A drop in two countries counts once in each — country counts legitimately
 * sum to more than the drop count. */
async function countryCounts(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ code: foodDropCountry.countryCode, n: count() })
    .from(foodDropCountry)
    .innerJoin(foodDrop, eq(foodDrop.id, foodDropCountry.foodDropId))
    .where(baseFeedWhere())
    .groupBy(foodDropCountry.countryCode);
  return new Map(rows.map((r) => [r.code, r.n]));
}

async function statusCounts(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ status: foodDrop.status, n: count() })
    .from(foodDrop)
    .where(baseFeedWhere())
    .groupBy(foodDrop.status);
  return new Map(rows.map((r) => [r.status, r.n]));
}

/** Only brands that actually appear — no zero-filling — ordered by count
 * desc then name asc. */
async function brandFacet(db: Database): Promise<Facets['brands']> {
  const rows = await db
    .select({ slug: brand.slug, label: brand.name, count: count() })
    .from(foodDrop)
    .innerJoin(brand, eq(brand.id, foodDrop.brandId))
    .where(baseFeedWhere())
    .groupBy(brand.slug, brand.name)
    .orderBy(desc(count()), brand.name);
  return rows.map((r) => ({ value: r.slug, label: r.label, count: r.count }));
}

export async function getFacets(db: Database): Promise<Facets> {
  const [categories, countries, statuses, brands] = await Promise.all([
    categoryCounts(db),
    countryCounts(db),
    statusCounts(db),
    brandFacet(db),
  ]);

  return {
    categories: buildFacetCounts(
      CATEGORIES,
      (c) => c.slug,
      (c) => c.name,
      categories,
    ),
    countries: buildFacetCounts(
      COUNTRIES,
      (c) => c.code,
      (c) => c.name,
      countries,
    ),
    statuses: buildFacetCounts(
      STATUSES,
      (s) => s.value,
      (s) => findStatusLabel(s.value),
      statuses,
    ),
    brands,
  };
}
