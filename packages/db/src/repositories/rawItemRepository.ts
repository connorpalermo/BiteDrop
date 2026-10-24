import type { Database } from '../client';
import { rawItem } from '../schema/index';

export interface InsertableRawItem {
  url: string; // already canonicalised (@bitedrop/core canonicalizeUrl)
  urlHash: Buffer; // sha256(url)
  contentHash: Buffer | null; // sha256(normalizeText(bodyText)), null if bodyText is null
  title: string | null;
  author: string | null;
  publishedAt: Date | null;
  excerpt: string | null;
  bodyText: string | null;
  imageUrl: string | null;
  rawPayload: unknown;
}

/**
 * Batched insert, `ON CONFLICT (source_id, url_hash) DO NOTHING` — the
 * idempotency guarantee (invariant 8). `RETURNING` only yields rows actually
 * inserted, so the returned count IS itemsNew with no separate query.
 */
export async function insertRawItems(
  db: Database,
  sourceId: string,
  fetchRunId: bigint,
  items: InsertableRawItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  const inserted = await db
    .insert(rawItem)
    .values(
      items.map((item) => ({
        sourceId,
        fetchRunId,
        url: item.url,
        urlHash: item.urlHash,
        contentHash: item.contentHash,
        title: item.title,
        author: item.author,
        publishedAt: item.publishedAt,
        excerpt: item.excerpt,
        bodyText: item.bodyText,
        imageUrl: item.imageUrl,
        rawPayload: item.rawPayload,
      })),
    )
    .onConflictDoNothing({ target: [rawItem.sourceId, rawItem.urlHash] })
    .returning({ id: rawItem.id });

  return inserted.length;
}
