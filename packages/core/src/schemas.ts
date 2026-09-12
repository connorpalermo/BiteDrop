import { z } from 'zod';

export const dropStatusSchema = z.enum([
  'new',
  'coming_soon',
  'limited_time',
  'returning',
  'discontinued',
  'rumored',
]);

export const categorySlugSchema = z.enum([
  'fast_food',
  'restaurants',
  'candy',
  'snacks',
  'chips',
  'drinks',
  'desserts',
  'grocery',
  'convenience',
  'seasonal',
  'other',
]);

export const countryCodeSchema = z.enum(['US', 'CA', 'MX', 'JP', 'KR', 'GB', 'DE', 'FR', 'AU']);

export const regionSchema = z.enum(['north_america', 'asia', 'europe', 'oceania']);

export const sortKeySchema = z.enum(['newest', 'trending']);

export const brandRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const categoryRefSchema = z.object({
  slug: categorySlugSchema,
  name: z.string(),
  emoji: z.string(),
});

export const countryRefSchema = z.object({
  code: countryCodeSchema,
  name: z.string(),
  emoji: z.string(),
  region: regionSchema,
});

export const retailerRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const sourceRefSchema = z.object({
  id: z.string(),
  sourceName: z.string(),
  title: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  discoveredAt: z.string(),
  isPrimary: z.boolean(),
});

export const foodDropSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: brandRefSchema.nullable(),
  category: categoryRefSchema,
  subcategory: z.string().nullable(),
  shortDescription: z.string().max(140),
  status: dropStatusSchema,
  isLimitedTime: z.boolean(),
  releaseDate: z.string().nullable(),
  availabilityStart: z.string().nullable(),
  availabilityEnd: z.string().nullable(),
  priceCents: z.number().int().nonnegative().nullable(),
  priceCurrency: z.string().length(3).nullable(),
  imageUrl: z.string().nullable(),
  countries: z.array(countryRefSchema),
  retailers: z.array(retailerRefSchema),
  sourceCount: z.number().int().nonnegative(),
  firstSeenAt: z.string(),
  trendingScore: z.number(),
});

export const foodDropDetailSchema = foodDropSummarySchema.extend({
  description: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(sourceRefSchema),
  relatedBySameBrand: z.array(foodDropSummarySchema).max(4),
  relatedBySameCategory: z.array(foodDropSummarySchema).max(4),
});
