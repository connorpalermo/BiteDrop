import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/schema/index';
import { seedDatabase } from '../src/seed/index';
import type { Database } from '../src/client';

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env.local, then run `npm run db:up`.',
    );
  }
  return url;
}

let db: Database | undefined;

/** One shared connection per test run (the db Vitest project runs files
 * sequentially — see vitest.config.ts — so this is never contended). */
export function getTestDb(): Database {
  if (!db) {
    const sql = postgres(testDatabaseUrl(), { max: 1 });
    db = drizzle(sql, { schema });
  }
  return db;
}

/** Truncates and reseeds from the mock data — called once per test file,
 * never per test, since every test in this suite only reads. */
export async function resetTestDb(): Promise<void> {
  try {
    await seedDatabase(getTestDb());
  } catch (err) {
    if (/ECONNREFUSED/.test(String(err))) {
      throw new Error(
        `Could not connect to the test database. Run \`npm run db:up\` first.\n${String(err)}`,
      );
    }
    throw err;
  }
}
