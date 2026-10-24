import { foodDropExtractionSchema } from '@bitedrop/core';
import {
  createFoodDropFromExtraction,
  listCandidateRawItems,
  listCategoryIds,
  listKnownBrands,
  markRawItemFailed,
  type CandidateRawItem,
  type Database,
  type KnownBrand,
} from '@bitedrop/db';
import { ruleBasedProvider, type ExtractionInput } from '@bitedrop/llm';
import { resolveSourceId } from './resolveSourceId';

const EXTRACTION_PROMPT =
  'Extract structured FoodDrop fields (name, brand, category, status, dates, price) from ' +
  'this article. Only match brandName against a name already present in knownBrandNames — ' +
  'never invent a brand that is not in that list.';

export interface ExtractStageResult {
  seen: number;
  created: number;
  failed: number;
  failures: { rawItemId: string; message: string }[];
}

interface ExtractDeps {
  knownBrands: KnownBrand[];
  categoryIds: Map<string, number>;
  dryRun: boolean;
}

/** One candidate, fully isolated: a thrown error or a failed extraction here
 * must never abort the rest of the batch (per-item isolation, the same
 * philosophy as Phase 4's per-source isolation one level down). */
async function extractOne(
  db: Database,
  candidate: CandidateRawItem,
  deps: ExtractDeps,
): Promise<{ outcome: 'created' | 'failed'; message?: string }> {
  try {
    const input: ExtractionInput = {
      title: candidate.title,
      excerpt: candidate.excerpt,
      bodyText: candidate.bodyText,
      discoveredAt: candidate.discoveredAt,
      sourceTrustTier: candidate.sourceTrustTier,
      knownBrandNames: deps.knownBrands.map((b) => b.name),
    };

    const result = await ruleBasedProvider.extract({
      schema: foodDropExtractionSchema,
      prompt: EXTRACTION_PROMPT,
      input: JSON.stringify(input),
    });

    if (!result.ok) {
      if (!deps.dryRun) await markRawItemFailed(db, candidate.id, result.error.message);
      return { outcome: 'failed', message: result.error.message };
    }

    const categoryId =
      deps.categoryIds.get(result.value.categorySlug) ?? deps.categoryIds.get('other');
    if (categoryId === undefined) {
      throw new Error("category 'other' is not seeded — cannot resolve a fallback categoryId");
    }
    const brandId = result.value.brandName
      ? (deps.knownBrands.find((b) => b.name === result.value.brandName)?.id ?? null)
      : null;

    if (!deps.dryRun) {
      await createFoodDropFromExtraction(db, candidate, result.value, { brandId, categoryId });
    }
    return { outcome: 'created' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!deps.dryRun) await markRawItemFailed(db, candidate.id, message);
    return { outcome: 'failed', message };
  }
}

export async function runExtractStage(
  db: Database,
  options: { sourceSlug?: string; dryRun: boolean },
): Promise<ExtractStageResult> {
  const sourceId = await resolveSourceId(db, options.sourceSlug);
  const candidates = await listCandidateRawItems(db, sourceId);
  const deps: ExtractDeps = {
    knownBrands: await listKnownBrands(db),
    categoryIds: await listCategoryIds(db),
    dryRun: options.dryRun,
  };

  let created = 0;
  const failures: { rawItemId: string; message: string }[] = [];

  for (const candidate of candidates) {
    const result = await extractOne(db, candidate, deps);
    if (result.outcome === 'created') created++;
    else failures.push({ rawItemId: candidate.id, message: result.message ?? 'unknown error' });
  }

  return { seen: candidates.length, created, failed: failures.length, failures };
}
