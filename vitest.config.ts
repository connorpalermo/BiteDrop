import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `fileParallelism` only takes effect as a root-level (or CLI) option —
    // it is silently ignored when nested inside an individual project's
    // `test` block. Set here so the "db" project's integration tests, which
    // share one seeded Postgres database and truncate/reseed between files
    // (docs/phases/phase-02-database.md S15), never run two files at once
    // and stomp on each other's data. Harmless for "core" (pure in-memory).
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'core',
          environment: 'node',
          include: ['packages/core/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: ['packages/db/test/**/*.test.ts'],
          // Unlike fileParallelism, setupFiles IS per-project — each
          // project needs its own DATABASE_URL/TEST_DATABASE_URL loaded
          // from .env.local, since `npm test` doesn't source it into the
          // shell itself.
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
