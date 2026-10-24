import {
  DEDUPE_DATE_WINDOW_DAYS,
  DEDUPE_FUZZY_SIMILARITY_THRESHOLD,
  DEDUPE_LINK_CONFIDENCE,
  normalizeName,
  shouldPublish,
  type DedupeLinkMethod,
  type FoodDropExtraction,
} from '@bitedrop/core';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { foodDrop, foodDropSource, rawItem } from '../schema/index';
import type { CandidateRawItem } from './extractRepository';

export interface DedupeMatch {
  foodDropId: string;
  linkMethod: DedupeLinkMethod;
  linkConfidence: number;
}

/** Layer 1 — the same canonical URL, already linked to a drop by a
 * different raw_item. COALESCE follows one tombstone hop so a match
 * against an already-merged drop resolves to the live winner. */
async function findExactUrlMatch(
  db: Database,
  candidate: CandidateRawItem,
): Promise<string | null> {
  const [row] = await db
    .select({ foodDropId: sql<string>`COALESCE(${foodDrop.mergedIntoId}, ${foodDrop.id})` })
    .from(rawItem)
    .innerJoin(foodDropSource, eq(foodDropSource.rawItemId, rawItem.id))
    .innerJoin(foodDrop, eq(foodDrop.id, foodDropSource.foodDropId))
    .where(and(eq(rawItem.urlHash, candidate.urlHash), ne(rawItem.id, candidate.id)))
    .limit(1);
  return row?.foodDropId ?? null;
}

/** Layer 2 — identical content_hash under a different URL (a syndicated
 * copy of the same article). Skipped by the caller when contentHash is
 * null. */
async function findContentHashMatch(db: Database, contentHash: Buffer): Promise<string | null> {
  const [row] = await db
    .select({ foodDropId: sql<string>`COALESCE(${foodDrop.mergedIntoId}, ${foodDrop.id})` })
    .from(rawItem)
    .innerJoin(foodDropSource, eq(foodDropSource.rawItemId, rawItem.id))
    .innerJoin(foodDrop, eq(foodDrop.id, foodDropSource.foodDropId))
    .where(eq(rawItem.contentHash, contentHash))
    .limit(1);
  return row?.foodDropId ?? null;
}

/** Layer 3 — same resolved brand, exact normalised name. */
async function findExactNameMatch(
  db: Database,
  brandId: string,
  normalizedName: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: foodDrop.id })
    .from(foodDrop)
    .where(
      and(
        eq(foodDrop.brandId, brandId),
        eq(foodDrop.normalizedName, normalizedName),
        isNull(foodDrop.mergedIntoId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Layer 4 — same brand, fuzzy name, discovered within the window. Reuses
 * word_similarity() over plain similarity() for the same reason Phase 2's
 * search fallback does (feedQuery.ts's searchFilter comment). */
async function findFuzzyMatch(
  db: Database,
  brandId: string,
  normalizedName: string,
  discoveredAt: string,
): Promise<string | null> {
  const rows = await db.execute<{ food_drop_id: string }>(sql`
    SELECT id AS food_drop_id FROM food_drop
    WHERE brand_id = ${brandId}
      AND merged_into_id IS NULL
      AND word_similarity(${normalizedName}, normalized_name) > ${DEDUPE_FUZZY_SIMILARITY_THRESHOLD}
      AND first_seen_at BETWEEN ${discoveredAt}::timestamptz - (${DEDUPE_DATE_WINDOW_DAYS} || ' days')::interval
                             AND ${discoveredAt}::timestamptz + (${DEDUPE_DATE_WINDOW_DAYS} || ' days')::interval
    ORDER BY word_similarity(${normalizedName}, normalized_name) DESC
    LIMIT 1
  `);
  return rows[0]?.food_drop_id ?? null;
}

/**
 * Runs the four layers in order, returning on the first hit. Layers 3/4 are
 * skipped entirely when brandId is null — most real items, per Phase 5's
 * findings, since brand matching only covers the Phase 2 mock's 8 brands.
 */
export async function findDedupeMatch(
  db: Database,
  candidate: CandidateRawItem,
  extraction: FoodDropExtraction,
  brandId: string | null,
): Promise<DedupeMatch | null> {
  const exactUrl = await findExactUrlMatch(db, candidate);
  if (exactUrl)
    return {
      foodDropId: exactUrl,
      linkMethod: 'exact_url',
      linkConfidence: DEDUPE_LINK_CONFIDENCE.exact_url,
    };

  if (candidate.contentHash) {
    const contentMatch = await findContentHashMatch(db, candidate.contentHash);
    if (contentMatch) {
      return {
        foodDropId: contentMatch,
        linkMethod: 'content_hash',
        linkConfidence: DEDUPE_LINK_CONFIDENCE.content_hash,
      };
    }
  }

  if (!brandId) return null;
  const normalizedName = normalizeName(extraction.name);

  const exactName = await findExactNameMatch(db, brandId, normalizedName);
  if (exactName) {
    return {
      foodDropId: exactName,
      linkMethod: 'name_brand',
      linkConfidence: DEDUPE_LINK_CONFIDENCE.name_brand,
    };
  }

  const fuzzy = await findFuzzyMatch(db, brandId, normalizedName, candidate.discoveredAt);
  if (fuzzy)
    return { foodDropId: fuzzy, linkMethod: 'fuzzy', linkConfidence: DEDUPE_LINK_CONFIDENCE.fuzzy };

  return null;
}

/**
 * Links a candidate to an already-existing drop instead of creating a new
 * one. Never touches the drop's descriptive fields (name, description,
 * status, ...) — only source_count, last_source_at, and confidence change,
 * and confidence only ever increases. published is re-evaluated against
 * the drop's existing status, which is what lets a previously-unpublished
 * drop publish once a second source corroborates it.
 */
export async function linkRawItemToFoodDrop(
  db: Database,
  candidate: CandidateRawItem,
  match: DedupeMatch,
  newExtraction: FoodDropExtraction,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [drop] = await tx
      .select({ status: foodDrop.status, confidence: foodDrop.confidence })
      .from(foodDrop)
      .where(eq(foodDrop.id, match.foodDropId));
    const nextConfidence = Math.max(drop!.confidence, newExtraction.confidence);

    await tx
      .update(foodDrop)
      .set({
        sourceCount: sql`${foodDrop.sourceCount} + 1`,
        lastSourceAt: sql`GREATEST(${foodDrop.lastSourceAt}, ${candidate.discoveredAt}::timestamptz)`,
        confidence: nextConfidence,
        published: shouldPublish(drop!.status, nextConfidence),
      })
      .where(eq(foodDrop.id, match.foodDropId));

    await tx.insert(foodDropSource).values({
      foodDropId: match.foodDropId,
      rawItemId: candidate.id,
      sourceId: candidate.sourceId,
      role: 'corroborating',
      linkMethod: match.linkMethod,
      linkConfidence: match.linkConfidence,
    });

    await tx.update(rawItem).set({ stage: 'linked' }).where(eq(rawItem.id, candidate.id));
  });
}
