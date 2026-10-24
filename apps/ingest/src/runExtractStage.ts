import { foodDropExtractionSchema, type FoodDropExtraction } from '@bitedrop/core';
import {
  createFoodDropFromExtraction,
  findDedupeMatch,
  linkRawItemToFoodDrop,
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
  linked: number;
  failed: number;
  failures: { rawItemId: string; message: string }[];
}

interface ExtractDeps {
  knownBrands: KnownBrand[];
  categoryIds: Map<string, number>;
  dryRun: boolean;
}

type ExtractOutcome =
  | { outcome: 'created' }
  | { outcome: 'linked'; foodDropId: string; linkMethod: string }
  | { outcome: 'failed'; message: string };

function resolveLinks(
  extraction: FoodDropExtraction,
  deps: ExtractDeps,
): { brandId: string | null; categoryId: number } {
  const categoryId = deps.categoryIds.get(extraction.categorySlug) ?? deps.categoryIds.get('other');
  if (categoryId === undefined) {
    throw new Error("category 'other' is not seeded — cannot resolve a fallback categoryId");
  }
  const brandId = extraction.brandName
    ? (deps.knownBrands.find((b) => b.name === extraction.brandName)?.id ?? null)
    : null;
  return { brandId, categoryId };
}

/** One candidate, fully isolated: a thrown error or a failed extraction here
 * must never abort the rest of the batch (per-item isolation, the same
 * philosophy as Phase 4's per-source isolation one level down). Dedupe is
 * always computed, even in --dry-run, so a dry run can report which path
 * it would have taken; only the two write calls are gated on !dryRun. */
async function extractOne(
  db: Database,
  candidate: CandidateRawItem,
  deps: ExtractDeps,
): Promise<ExtractOutcome> {
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

    const { brandId, categoryId } = resolveLinks(result.value, deps);

    const match = await findDedupeMatch(db, candidate, result.value, brandId);
    if (match) {
      if (!deps.dryRun) await linkRawItemToFoodDrop(db, candidate, match, result.value);
      return { outcome: 'linked', foodDropId: match.foodDropId, linkMethod: match.linkMethod };
    }

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
  let linked = 0;
  const failures: { rawItemId: string; message: string }[] = [];

  for (const candidate of candidates) {
    const result = await extractOne(db, candidate, deps);
    if (result.outcome === 'created') created++;
    else if (result.outcome === 'linked') {
      linked++;
      if (options.dryRun) {
        console.log(
          `[dry-run] ${candidate.id} would link to food_drop ${result.foodDropId} via ${result.linkMethod}`,
        );
      }
    } else {
      failures.push({ rawItemId: candidate.id, message: result.message });
    }
  }

  return { seen: candidates.length, created, linked, failed: failures.length, failures };
}
