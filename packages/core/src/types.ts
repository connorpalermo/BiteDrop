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
 * Page and Facets are plain interfaces, not Zod schemas — they're structural
 * containers, and the values inside them (FoodDropSummary etc.) are already
 * validated at their own boundary. A Zod generic here would just be ceremony
 * wrapping an already-validated shape.
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
