import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';
import { loadDbConfig } from './config';

export type Database = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): Database {
  const sql = postgres(url);
  return drizzle(sql, { schema });
}

// Next's dev server re-evaluates modules on every hot reload; a plain
// module-level `const` would open a fresh connection pool each time until
// Postgres refuses new connections. Stashing on globalThis survives reloads.
const globalForDb = globalThis as unknown as { __bitedropDb?: Database };

export function getDb(): Database {
  globalForDb.__bitedropDb ??= createDb(loadDbConfig().DATABASE_URL);
  return globalForDb.__bitedropDb;
}
