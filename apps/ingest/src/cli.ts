import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadDbConfig, schema } from '@bitedrop/db';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runFetchStage } from './runFetchStage';

loadEnv({ path: path.join(process.cwd(), '.env.local'), quiet: true });

const STAGE_OWNERS: Record<string, string> = {
  filter: 'Phase 5',
  extract: 'Phase 5/8',
  normalize: 'Phase 5',
  dedupe: 'Phase 6',
  enrich: 'Phase 9',
  publish: 'Phase 5',
};

function parseCliArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      stage: { type: 'string', default: 'fetch' },
    },
  });
  return {
    source: values.source,
    dryRun: values['dry-run'] ?? false,
    stage: values.stage ?? 'fetch',
  };
}

async function main() {
  const { source, dryRun, stage } = parseCliArgs(process.argv.slice(2));

  if (stage !== 'fetch') {
    const owner = STAGE_OWNERS[stage] ?? 'a later phase';
    throw new Error(
      `--stage=${stage} is not implemented until ${owner}. Only "fetch" exists today.`,
    );
  }

  const { DATABASE_URL } = loadDbConfig();
  // A one-shot CLI, not the long-lived dev server createDb()/getDb() target
  // — opens its own connection and closes it so the process actually exits
  // instead of being kept alive by an open pool (same pattern as
  // migrate.ts/seed/run.ts).
  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql, { schema });

  try {
    const results = await runFetchStage(db, { sourceSlug: source, dryRun });
    for (const result of results) {
      console.log(
        `${result.sourceSlug}: ${result.status} — seen ${result.itemsSeen}, new ${result.itemsNew}` +
          (result.error ? ` — ${result.error}` : ''),
      );
    }

    const failed = results.filter((r) => r.status === 'error');
    if (failed.length > 0) {
      console.error(`${failed.length} of ${results.length} source(s) failed.`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
