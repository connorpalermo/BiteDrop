import type { FilterableItem } from '@bitedrop/core';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { rawItem } from '../schema/index';

export interface FilterableRawItem extends FilterableItem {
  id: string;
}

export async function listDiscoveredRawItems(
  db: Database,
  sourceId?: string,
): Promise<FilterableRawItem[]> {
  const clauses = [eq(rawItem.stage, 'discovered')];
  if (sourceId) clauses.push(eq(rawItem.sourceId, sourceId));

  const rows = await db
    .select()
    .from(rawItem)
    .where(and(...clauses));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    bodyText: row.bodyText,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    discoveredAt: row.discoveredAt.toISOString(),
  }));
}

export interface FilterVerdictWrite {
  rawItemId: string;
  passed: boolean;
  reason: string | null;
}

/**
 * One transaction of individual UPDATEs — not the N+1 pattern CLAUDE.md warns
 * about. That rule targets request-serving reads; this is a batch job writing
 * a bounded number of rows once per run, and a multi-row `UPDATE ... FROM
 * (VALUES ...)` would buy nothing but complexity at this volume.
 */
export async function applyFilterVerdicts(
  db: Database,
  verdicts: FilterVerdictWrite[],
): Promise<void> {
  if (verdicts.length === 0) return;

  await db.transaction(async (tx) => {
    for (const verdict of verdicts) {
      await tx
        .update(rawItem)
        .set({
          stage: verdict.passed ? 'candidate' : 'rejected',
          filterReason: verdict.reason,
        })
        .where(eq(rawItem.id, verdict.rawItemId));
    }
  });
}
