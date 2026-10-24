import { schema, type Database } from '@bitedrop/db';
import { seedDatabase } from '@bitedrop/db/seed';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

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

/** Mirrors packages/db/test/testDb.ts, kept local rather than reaching across
 * the package boundary into another package's test directory. */
export function getTestDb(): Database {
  if (!db) {
    const sql = postgres(testDatabaseUrl(), { max: 1 });
    db = drizzle(sql, { schema });
  }
  return db;
}

export async function resetTestDb(): Promise<void> {
  await seedDatabase(getTestDb());
}
