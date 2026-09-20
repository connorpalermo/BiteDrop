import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadDbConfig } from '../config';
import * as schema from '../schema/index';
import { seedDatabase } from './index';

loadEnv({ path: path.join(process.cwd(), '.env.local'), quiet: true });

async function main() {
  const { DATABASE_URL } = loadDbConfig();
  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql, { schema });

  console.log(`Seeding ${DATABASE_URL} ...`);
  await seedDatabase(db);
  console.log('Seed complete.');

  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
