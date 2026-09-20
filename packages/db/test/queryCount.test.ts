import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { PgFoodDropRepository } from '../src/repositories/foodDropRepository';
import * as schema from '../src/schema/index';
import { resetTestDb } from './testDb';

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set.');
  return url;
}

/**
 * A fresh connection with its own statement log, separate from the shared
 * testDb.ts connection so counting one test's statements never picks up
 * another test's queries.
 *
 * postgres.js runs a one-time internal type-discovery query the first time a
 * brand-new connection is used, to resolve custom type OIDs — a real
 * statement on the wire, but a one-time connection-setup cost the long-lived
 * connection `getDb()` uses in production amortises to zero, not part of the
 * per-request budget this test measures. A throwaway warmup query absorbs it
 * before the statement log starts recording.
 */
async function connectWithStatementLog() {
  const statements: string[] = [];
  const sql = postgres(testDatabaseUrl(), { max: 1, debug: (_c, query) => statements.push(query) });
  const db = drizzle(sql, { schema });
  await sql`SELECT 1`; // triggers the one-time type-discovery query, outside the count
  statements.length = 0;
  return { db, statements, close: () => sql.end() };
}

describe('query count budgets', () => {
  beforeAll(async () => {
    await resetTestDb();
  }, 30_000);

  it('list() on a full page issues at most 3 statements', async () => {
    const { db, statements, close } = await connectWithStatementLog();
    const repo = new PgFoodDropRepository(db);
    await repo.list({ limit: 12, sort: 'newest' });
    expect(statements.length).toBeLessThanOrEqual(3);
    await close();
  });

  it('list() returning 0 rows issues exactly 1 statement', async () => {
    const { db, statements, close } = await connectWithStatementLog();
    const repo = new PgFoodDropRepository(db);
    await repo.list({ limit: 12, sort: 'newest', search: 'zzz-no-such-drop-zzz' });
    expect(statements.length).toBe(1);
    await close();
  });

  it('list() at limit 40 issues the same number of statements as limit 12 (budget does not scale with rows)', async () => {
    const small = await connectWithStatementLog();
    await new PgFoodDropRepository(small.db).list({ limit: 12, sort: 'newest' });
    const smallCount = small.statements.length;
    await small.close();

    const large = await connectWithStatementLog();
    await new PgFoodDropRepository(large.db).list({ limit: 40, sort: 'newest' });
    const largeCount = large.statements.length;
    await large.close();

    expect(largeCount).toBe(smallCount);
  });

  it('getBySlug() on a drop with related drops issues at most 6 statements', async () => {
    const { db, statements, close } = await connectWithStatementLog();
    const repo = new PgFoodDropRepository(db);
    await repo.getBySlug('reeses-caramel-apple-cups');
    expect(statements.length).toBeLessThanOrEqual(6);
    await close();
  });
});
