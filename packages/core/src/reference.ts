import type { CategoryRef, CountryRef, DropStatus, FacetCount, RetailerRef } from './types';

export const CATEGORIES: readonly CategoryRef[] = [
  { slug: 'fast_food', name: 'Fast Food', emoji: '🍔' },
  { slug: 'restaurants', name: 'Restaurants', emoji: '🍽️' },
  { slug: 'candy', name: 'Candy', emoji: '🍫' },
  { slug: 'snacks', name: 'Snacks', emoji: '🍿' },
  { slug: 'chips', name: 'Chips', emoji: '🥔' },
  { slug: 'drinks', name: 'Drinks', emoji: '🥤' },
  { slug: 'desserts', name: 'Desserts', emoji: '🍦' },
  { slug: 'grocery', name: 'Grocery', emoji: '🛒' },
  { slug: 'convenience', name: 'Convenience', emoji: '🏪' },
  { slug: 'seasonal', name: 'Seasonal', emoji: '🎃' },
  { slug: 'other', name: 'Other', emoji: '✨' },
];

export const COUNTRIES: readonly CountryRef[] = [
  { code: 'US', name: 'United States', emoji: '🇺🇸', region: 'north_america' },
  { code: 'CA', name: 'Canada', emoji: '🇨🇦', region: 'north_america' },
  { code: 'MX', name: 'Mexico', emoji: '🇲🇽', region: 'north_america' },
  { code: 'JP', name: 'Japan', emoji: '🇯🇵', region: 'asia' },
  { code: 'KR', name: 'South Korea', emoji: '🇰🇷', region: 'asia' },
  { code: 'GB', name: 'United Kingdom', emoji: '🇬🇧', region: 'europe' },
  { code: 'DE', name: 'Germany', emoji: '🇩🇪', region: 'europe' },
  { code: 'FR', name: 'France', emoji: '🇫🇷', region: 'europe' },
  { code: 'AU', name: 'Australia', emoji: '🇦🇺', region: 'oceania' },
];

export const RETAILERS: readonly RetailerRef[] = [
  { slug: 'target', name: 'Target' },
  { slug: 'walmart', name: 'Walmart' },
  { slug: 'costco', name: 'Costco' },
  { slug: 'kroger', name: 'Kroger' },
  { slug: 'cvs', name: 'CVS' },
  { slug: 'walgreens', name: 'Walgreens' },
  { slug: 'seven_eleven', name: '7-Eleven' },
  { slug: 'circle_k', name: 'Circle K' },
  { slug: 'amazon', name: 'Amazon' },
  { slug: 'mcdonalds', name: "McDonald's" },
  { slug: 'taco_bell', name: 'Taco Bell' },
  { slug: 'wendys', name: "Wendy's" },
  { slug: 'burger_king', name: 'Burger King' },
  { slug: 'starbucks', name: 'Starbucks' },
  { slug: 'dunkin', name: "Dunkin'" },
  { slug: 'chick_fil_a', name: 'Chick-fil-A' },
];

export function findCategory(slug: string): CategoryRef {
  const found = CATEGORIES.find((c) => c.slug === slug);
  if (!found) throw new Error(`Unknown category slug: ${slug}`);
  return found;
}

export function findCountry(code: string): CountryRef {
  const found = COUNTRIES.find((c) => c.code === code);
  if (!found) throw new Error(`Unknown country code: ${code}`);
  return found;
}

export function findRetailer(slug: string): RetailerRef {
  const found = RETAILERS.find((r) => r.slug === slug);
  if (!found) throw new Error(`Unknown retailer slug: ${slug}`);
  return found;
}

export const STATUSES: readonly { value: DropStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'limited_time', label: 'Limited Time' },
  { value: 'returning', label: 'Returning' },
  { value: 'discontinued', label: 'Discontinued' },
  { value: 'rumored', label: 'Unconfirmed' },
];

export function findStatusLabel(status: DropStatus): string {
  const found = STATUSES.find((s) => s.value === status);
  if (!found) throw new Error(`Unknown status: ${status}`);
  return found.label;
}

/** Zero-fills a facet's counts against its closed, canonical set — every
 * category/country/status appears even when its count is 0, so the sidebar
 * never drops an option just because nothing currently matches it. Shared by
 * MockFoodDropRepository and PgFoodDropRepository so both compute facets()
 * identically instead of maintaining two copies of the same rule. */
export function buildFacetCounts<T, V extends string>(
  canonical: readonly T[],
  valueOf: (t: T) => V,
  labelOf: (t: T) => string,
  counts: ReadonlyMap<string, number>,
): FacetCount<V>[] {
  return canonical.map((t) => ({
    value: valueOf(t),
    label: labelOf(t),
    count: counts.get(valueOf(t)) ?? 0,
  }));
}
