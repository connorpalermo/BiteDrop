import type { IngestSource } from '@bitedrop/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { source } from '../schema/index';

function toIngestSource(row: typeof source.$inferSelect): IngestSource {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    url: row.url,
    config: row.config as Record<string, unknown>,
    httpEtag: row.httpEtag,
    httpLastModified: row.httpLastModified,
    consecutiveFailures: row.consecutiveFailures,
  };
}

/** Enabled sources, optionally narrowed to one slug (the CLI's --source flag). */
export async function listIngestSources(
  db: Database,
  filterSlug?: string,
): Promise<IngestSource[]> {
  const clauses = [eq(source.enabled, true)];
  if (filterSlug) clauses.push(eq(source.slug, filterSlug));

  const rows = await db
    .select()
    .from(source)
    .where(and(...clauses));
  return rows.map(toIngestSource);
}

export interface SourceHealthPatch {
  lastAttemptAt: Date;
  lastSuccessAt: Date | null; // null on failure — leaves the prior value in place
  consecutiveFailures: number; // caller computes: 0 on success, +1 on failure
  lastError: string | null;
  httpEtag: string | null;
  httpLastModified: string | null;
}

export async function updateSourceHealth(
  db: Database,
  sourceId: string,
  patch: SourceHealthPatch,
): Promise<void> {
  // lastSuccessAt is only included on a success — omitting the key (rather
  // than setting it to NULL) is what leaves the prior successful-run
  // timestamp in place on a failed run.
  const values: Partial<typeof source.$inferInsert> = {
    lastAttemptAt: patch.lastAttemptAt,
    consecutiveFailures: patch.consecutiveFailures,
    lastError: patch.lastError,
    httpEtag: patch.httpEtag,
    httpLastModified: patch.httpLastModified,
    updatedAt: new Date(),
  };
  if (patch.lastSuccessAt) values.lastSuccessAt = patch.lastSuccessAt;

  await db.update(source).set(values).where(eq(source.id, sourceId));
}
