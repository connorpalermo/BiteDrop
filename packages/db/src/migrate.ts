import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadDbConfig } from './config';

loadEnv({ path: path.join(process.cwd(), '.env.local'), quiet: true });

const dir = path.dirname(fileURLToPath(import.meta.url));

// Locally and in CI these already exist (docker-compose's and the CI
// workflow's init scripts create them); on a fresh target like a new Neon
// project they don't. Idempotent, so safe to run every time regardless.
async function ensureExtensions(sql: postgres.Sql): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`;
}

async function migrateUrl(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  console.log(`Migrating ${url} ...`);
  await ensureExtensions(sql);
  await migrate(db, { migrationsFolder: path.join(dir, '../migrations') });

  await sql.end();
}

/**
 * Also migrates TEST_DATABASE_URL when it's set, not just DATABASE_URL —
 * `docker compose down -v` (part of `db:reset`) destroys both databases'
 * schemas at once, and only ever calling this against the dev database
 * would leave `bitedrop_test` schemaless until someone remembered to migrate
 * it by hand, breaking `npm test` right after the exact command
 * (`db:reset`) meant to leave the repo in a clean, working state.
 */
async function main() {
  const { DATABASE_URL } = loadDbConfig();
  await migrateUrl(DATABASE_URL);

  const testUrl = process.env.TEST_DATABASE_URL;
  if (testUrl) await migrateUrl(testUrl);

  console.log('Migrations applied.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
