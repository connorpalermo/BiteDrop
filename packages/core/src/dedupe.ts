import type { DropStatus } from './types';

/** pg_trgm's own default — same threshold Phase 2's search fallback uses. */
export const DEDUPE_FUZZY_SIMILARITY_THRESHOLD = 0.3;

/** Layer 4's discovery-proximity window, symmetric: a slower-crawled source
 * can legitimately discover the same real-world event a few days after a
 * faster one did. */
export const DEDUPE_DATE_WINDOW_DAYS = 14;

export type DedupeLinkMethod = 'exact_url' | 'content_hash' | 'name_brand' | 'fuzzy';

export const DEDUPE_LINK_CONFIDENCE: Record<DedupeLinkMethod, number> = {
  exact_url: 1.0, // Layer 1 — certain
  content_hash: 1.0, // Layer 2 — certain
  name_brand: 0.9, // Layer 3 — high
  fuzzy: 0.7, // Layer 4 — medium
};

export const PUBLISH_CONFIDENCE_THRESHOLD = 0.6;

/** Shared by both the create path (Phase 5) and the dedupe-link path
 * (Phase 6) — one threshold, not two copies of the same constant. */
export function shouldPublish(status: DropStatus, confidence: number): boolean {
  return status !== 'rumored' && confidence >= PUBLISH_CONFIDENCE_THRESHOLD;
}
