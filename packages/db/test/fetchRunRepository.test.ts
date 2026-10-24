import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  finishFetchRun,
  startFetchRun,
  type FetchRunStatus,
} from '../src/repositories/fetchRunRepository';
import { listIngestSources } from '../src/repositories/sourceRepository';
import { fetchRun } from '../src/schema/index';
import { getTestDb, resetTestDb } from './testDb';

const STATUSES: FetchRunStatus[] = ['success', 'partial', 'error', 'skipped_not_modified'];

describe('fetchRunRepository', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('startFetchRun inserts a row that survives even if finishFetchRun never runs', async () => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const id = await startFetchRun(db, brandEating!.id);
    const [row] = await db.select().from(fetchRun).where(eq(fetchRun.id, id));
    expect(row).toBeDefined();
    expect(row!.finishedAt).toBeNull();
  });

  it.each(STATUSES)('round-trips fetch_status %s', async (status) => {
    const db = getTestDb();
    const [brandEating] = await listIngestSources(db, 'brandeating-rss');
    const id = await startFetchRun(db, brandEating!.id);
    await finishFetchRun(db, id, {
      status,
      httpStatus: 200,
      itemsSeen: 3,
      itemsNew: 2,
      errorKind: null,
      errorMessage: null,
      durationMs: 123,
    });
    const [row] = await db.select().from(fetchRun).where(eq(fetchRun.id, id));
    expect(row!.status).toBe(status);
    expect(row!.finishedAt).not.toBeNull();
    expect(row!.itemsNew).toBe(2);
  });
});
