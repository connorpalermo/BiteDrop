import { findCountry, type CountryRef, type RetailerRef } from '@bitedrop/core';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../client';
import { foodDropCountry, foodDropRetailer, retailer } from '../schema/index';

export interface ChildData {
  countriesByDropId: Map<string, CountryRef[]>;
  retailersByDropId: Map<string, RetailerRef[]>;
}

function groupBy<Row, V>(
  rows: Row[],
  keyOf: (row: Row) => string,
  valueOf: (row: Row) => V,
): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key);
    if (list) list.push(valueOf(row));
    else map.set(key, [valueOf(row)]);
  }
  return map;
}

async function loadCountries(db: Database, dropIds: string[]): Promise<Map<string, CountryRef[]>> {
  const rows = await db
    .select({
      foodDropId: foodDropCountry.foodDropId,
      countryCode: foodDropCountry.countryCode,
      isPrimary: foodDropCountry.isPrimary,
    })
    .from(foodDropCountry)
    .where(inArray(foodDropCountry.foodDropId, dropIds))
    .orderBy(desc(foodDropCountry.isPrimary), foodDropCountry.countryCode);

  return groupBy(
    rows,
    (r) => r.foodDropId,
    (r) => findCountry(r.countryCode),
  );
}

async function loadRetailers(db: Database, dropIds: string[]): Promise<Map<string, RetailerRef[]>> {
  const rows = await db
    .select({
      foodDropId: foodDropRetailer.foodDropId,
      slug: retailer.slug,
      name: retailer.name,
    })
    .from(foodDropRetailer)
    .innerJoin(retailer, eq(retailer.id, foodDropRetailer.retailerId))
    .where(inArray(foodDropRetailer.foodDropId, dropIds))
    .orderBy(retailer.name);

  return groupBy(
    rows,
    (r) => r.foodDropId,
    (r): RetailerRef => ({ slug: r.slug, name: r.name }),
  );
}

/**
 * Batched countries + retailers for a set of drop ids, shared by list() and
 * getBySlug() — one query per collection (`WHERE food_drop_id = ANY($1)`),
 * never a query per row.
 */
export async function loadChildren(db: Database, dropIds: string[]): Promise<ChildData> {
  if (dropIds.length === 0) {
    return { countriesByDropId: new Map(), retailersByDropId: new Map() };
  }
  const [countriesByDropId, retailersByDropId] = await Promise.all([
    loadCountries(db, dropIds),
    loadRetailers(db, dropIds),
  ]);
  return { countriesByDropId, retailersByDropId };
}
