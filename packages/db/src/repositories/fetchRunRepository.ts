import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { fetchRun } from '../schema/index';

export type FetchRunStatus = 'success' | 'partial' | 'error' | 'skipped_not_modified';

/**
 * Inserts a row immediately, before the real fetch happens, with a
 * placeholder status that finishFetchRun always overwrites — so a crash
 * between start and finish still leaves an observable row instead of
 * silently losing the attempt.
 */
export async function startFetchRun(db: Database, sourceId: string): Promise<bigint> {
  const [row] = await db
    .insert(fetchRun)
    .values({ sourceId, status: 'error' })
    .returning({ id: fetchRun.id });
  return row!.id;
}

export interface FetchRunFinishPatch {
  status: FetchRunStatus;
  httpStatus: number | null;
  itemsSeen: number;
  itemsNew: number;
  errorKind: string | null;
  errorMessage: string | null;
  durationMs: number;
}

export async function finishFetchRun(
  db: Database,
  fetchRunId: bigint,
  patch: FetchRunFinishPatch,
): Promise<void> {
  await db
    .update(fetchRun)
    .set({
      finishedAt: new Date(),
      status: patch.status,
      httpStatus: patch.httpStatus,
      itemsSeen: patch.itemsSeen,
      itemsNew: patch.itemsNew,
      errorKind: patch.errorKind,
      errorMessage: patch.errorMessage,
      durationMs: patch.durationMs,
    })
    .where(eq(fetchRun.id, fetchRunId));
}
