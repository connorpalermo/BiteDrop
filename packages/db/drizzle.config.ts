import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit resolves `schema`/`out` against process.cwd(), not this file's
// location — and the npm scripts invoke this config from the repo root via
// `--config packages/db/drizzle.config.ts`. Anchor to this file's own
// directory so generate/migrate/studio work the same regardless of the
// caller's cwd. (import.meta.dirname is unreliable through drizzle-kit's
// esbuild bundling, so derive it from import.meta.url instead.)
const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: path.join(dir, 'src/schema/index.ts'),
  out: path.join(dir, 'migrations'),
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
  // Timestamp-prefixed names sort in generation order and read as dates.
  migrations: { prefix: 'timestamp' },
});
