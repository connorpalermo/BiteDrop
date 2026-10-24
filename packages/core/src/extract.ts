import { z } from 'zod';
import { categorySlugSchema, dropStatusSchema } from './schemas';

/**
 * The shared contract a rule-based provider (Phase 5) and a future cloud
 * provider (Phase 8) must both produce — the schema is the shared contract;
 * the extraction logic is provider-specific and lives with each provider.
 */
export const foodDropExtractionSchema = z.object({
  name: z.string().min(1).max(200),
  brandName: z.string().nullable(),
  categorySlug: categorySlugSchema,
  subcategory: z.string().nullable(),
  shortDescription: z.string().max(140),
  description: z.string(),
  status: dropStatusSchema,
  isLimitedTime: z.boolean(),
  releaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  priceCents: z.number().int().nonnegative().nullable(),
  priceCurrency: z.string().length(3).nullable(),
  confidence: z.number().min(0).max(1),
});

export type FoodDropExtraction = z.infer<typeof foodDropExtractionSchema>;
