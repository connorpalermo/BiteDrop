import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadDbConfig, schema, type Database } from '@bitedrop/db';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runExtractStage } from './runExtractStage';
import { runFetchStage } from './runFetchStage';
import { runFilterStage } from './runFilterStage';

loadEnv({ path: path.join(process.cwd(), '.env.local'), quiet: true });

const VALID_STAGES = ['fetch', 'filter', 'extract'] as const;
type Stage = (typeof VALID_STAGES)[number];

const STAGE_OWNERS: Record<string, string> = {
  normalize: 'folded into --stage=extract, not a separate stage',
  dedupe:
    'folded into --stage=extract — matching runs before a new food_drop would be created, ' +
    'not as a separate pass (see docs/phases/phase-06-deduplication.md)',
  enrich: 'Phase 9',
  publish:
    'there is no separate publish stage — publishing happens automatically during ' +
    'extraction based on confidence (see docs/phases/phase-05-filter-extract.md)',
};

function isValidStage(value: string): value is Stage {
  return (VALID_STAGES as readonly string[]).includes(value);
}

function parseCliArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      stage: { type: 'string' },
    },
  });
  return { source: values.source, dryRun: values['dry-run'] ?? false, stage: values.stage };
}

async function runFetch(
  db: Database,
  source: string | undefined,
  dryRun: boolean,
): Promise<boolean> {
  const results = await runFetchStage(db, { sourceSlug: source, dryRun });
  for (const result of results) {
    console.log(
      `fetch   ${result.sourceSlug}: ${result.status} — seen ${result.itemsSeen}, new ${result.itemsNew}` +
        (result.error ? ` — ${result.error}` : ''),
    );
  }
  return results.every((r) => r.status !== 'error');
}

async function runFilter(
  db: Database,
  source: string | undefined,
  dryRun: boolean,
): Promise<boolean> {
  const result = await runFilterStage(db, { sourceSlug: source, dryRun });
  console.log(
    `filter  seen ${result.seen}, passed ${result.passed}, rejected ${result.rejected}` +
      (result.rejected > 0 ? ` (${JSON.stringify(result.reasonCounts)})` : ''),
  );
  return true;
}

async function runExtract(
  db: Database,
  source: string | undefined,
  dryRun: boolean,
): Promise<boolean> {
  const result = await runExtractStage(db, { sourceSlug: source, dryRun });
  console.log(
    `extract seen ${result.seen}, created ${result.created}, linked ${result.linked}, failed ${result.failed}`,
  );
  for (const failure of result.failures) {
    console.log(`  failed ${failure.rawItemId}: ${failure.message}`);
  }
  return result.failed === 0;
}

async function main() {
  const { source, dryRun, stage } = parseCliArgs(process.argv.slice(2));

  if (stage !== undefined && !isValidStage(stage)) {
    const owner = STAGE_OWNERS[stage] ?? 'a later phase';
    throw new Error(`--stage=${stage} is not implemented: ${owner}.`);
  }

  const { DATABASE_URL } = loadDbConfig();
  // A one-shot CLI, not the long-lived dev server createDb()/getDb() target
  // — opens its own connection and closes it so the process actually exits
  // instead of being kept alive by an open pool (same pattern as
  // migrate.ts/seed/run.ts).
  //
  // prepare: false — unlike db:seed (one big transaction), a full ingest
  // run issues many separate transactions (one per fetch source, one for
  // filter, one per extract/dedupe candidate). Against a transaction-mode
  // pooler (Neon's pooled endpoint, PgBouncer) each one can land on a
  // different backend, so a prepared statement from an earlier transaction
  // may not exist for a later one — phase-03-deploy.md S3's exact reasoning
  // for createDb(), which this CLI doesn't otherwise share.
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(sql, { schema });

  try {
    // No --stage: run the full pipeline. One stage given: run only that one,
    // over whatever rows are already sitting at the stage before it.
    const stagesToRun: Stage[] = stage ? [stage] : [...VALID_STAGES];
    let allOk = true;
    for (const current of stagesToRun) {
      const ok =
        current === 'fetch'
          ? await runFetch(db, source, dryRun)
          : current === 'filter'
            ? await runFilter(db, source, dryRun)
            : await runExtract(db, source, dryRun);
      allOk &&= ok;
    }
    if (!allOk) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
