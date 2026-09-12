import type { z } from 'zod';
import type {
  brandRefSchema,
  categoryRefSchema,
  categorySlugSchema,
  countryCodeSchema,
  countryRefSchema,
  dropStatusSchema,
  foodDropDetailSchema,
  foodDropSummarySchema,
  regionSchema,
  retailerRefSchema,
  sortKeySchema,
  sourceRefSchema,
} from './schemas';

export type DropStatus = z.infer<typeof dropStatusSchema>;
export type CategorySlug = z.infer<typeof categorySlugSchema>;
export type CountryCode = z.infer<typeof countryCodeSchema>;
export type Region = z.infer<typeof regionSchema>;
export type SortKey = z.infer<typeof sortKeySchema>;

export type BrandRef = z.infer<typeof brandRefSchema>;
export type CategoryRef = z.infer<typeof categoryRefSchema>;
export type CountryRef = z.infer<typeof countryRefSchema>;
export type RetailerRef = z.infer<typeof retailerRefSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type FoodDropSummary = z.infer<typeof foodDropSummarySchema>;
export type FoodDropDetail = z.infer<typeof foodDropDetailSchema>;

/**
 * Page and Facets are structural containers, not data crossing a validation
 * boundary in Phase 1 — mock data is constructed directly in TypeScript, never
 * parsed from JSON. A Zod generic here would add ceremony with nothing to guard
 * against yet. Revisit when Phase 2 introduces a real HTTP/DB boundary for these
 * shapes.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface FacetCount<T> {
  value: T;
  label: string;
  count: number;
}

export interface Facets {
  categories: FacetCount<CategorySlug>[];
  countries: FacetCount<CountryCode>[];
  statuses: FacetCount<DropStatus>[];
  brands: FacetCount<string>[];
}
