import type { IngestSource, IngestSourceType, SourceAdapter } from '@bitedrop/core';
import {
  finishFetchRun,
  insertRawItems,
  listIngestSources,
  startFetchRun,
  updateSourceHealth,
  type Database,
} from '@bitedrop/db';
import { getAdapter, isFetchAllowed } from '@bitedrop/sources';
import { hashItem } from './hashItem';
import { FETCH_TIMEOUT_MS, USER_AGENT } from './userAgent';

export interface FetchStageDeps {
  getAdapter: (type: IngestSourceType) => SourceAdapter;
  isFetchAllowed: (feedUrl: string, userAgent: string, timeoutMs: number) => Promise<boolean>;
}

const DEFAULT_DEPS: FetchStageDeps = { getAdapter, isFetchAllowed };

export interface FetchStageSourceResult {
  sourceSlug: string;
  status: 'success' | 'skipped_not_modified' | 'error' | 'robots_blocked';
  itemsSeen: number;
  itemsNew: number;
  error?: string;
}

export interface FetchStageOptions {
  sourceSlug?: string;
  dryRun: boolean;
}

function classifyError(message: string): string {
  if (/unrecognized feed format/i.test(message)) return 'parse_error';
  if (/responded \d+/.test(message)) return 'http_error';
  return 'timeout';
}

interface SuccessOutcome {
  fetchRunId: bigint;
  startedAt: number;
  status: 'success' | 'skipped_not_modified';
  itemsSeen: number;
  itemsNew: number;
  etag: string | null;
  lastModified: string | null;
}

async function persistSuccess(
  db: Database,
  src: IngestSource,
  outcome: SuccessOutcome,
): Promise<void> {
  await finishFetchRun(db, outcome.fetchRunId, {
    status: outcome.status,
    httpStatus: outcome.status === 'success' ? 200 : 304,
    itemsSeen: outcome.itemsSeen,
    itemsNew: outcome.itemsNew,
    errorKind: null,
    errorMessage: null,
    durationMs: Date.now() - outcome.startedAt,
  });
  await updateSourceHealth(db, src.id, {
    lastAttemptAt: new Date(),
    lastSuccessAt: new Date(),
    consecutiveFailures: 0,
    lastError: null,
    httpEtag: outcome.etag,
    httpLastModified: outcome.lastModified,
  });
}

async function recordFailure(db: Database, src: IngestSource, message: string): Promise<void> {
  await updateSourceHealth(db, src.id, {
    lastAttemptAt: new Date(),
    lastSuccessAt: null,
    consecutiveFailures: src.consecutiveFailures + 1,
    lastError: message,
    httpEtag: src.httpEtag,
    httpLastModified: src.httpLastModified,
  });
}

/** --dry-run writes nothing — not even a fetch_run row (acceptance criterion 14). */
async function runDryRun(src: IngestSource, deps: FetchStageDeps): Promise<FetchStageSourceResult> {
  try {
    const allowed = await deps.isFetchAllowed(src.url, USER_AGENT, FETCH_TIMEOUT_MS);
    if (!allowed)
      return { sourceSlug: src.slug, status: 'robots_blocked', itemsSeen: 0, itemsNew: 0 };

    const adapter = deps.getAdapter(src.type);
    const result = await adapter.fetch(src, { timeoutMs: FETCH_TIMEOUT_MS, userAgent: USER_AGENT });
    const itemsSeen = result.notModified ? 0 : result.items.length;
    const status = result.notModified ? 'skipped_not_modified' : 'success';
    console.log(
      `[dry-run] ${src.slug}: ${status}, ${itemsSeen} item(s) discovered, nothing written`,
    );
    return { sourceSlug: src.slug, status, itemsSeen, itemsNew: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sourceSlug: src.slug, status: 'error', itemsSeen: 0, itemsNew: 0, error: message };
  }
}

/**
 * startFetchRun runs before the adapter call, not after — so a crash during
 * the fetch itself (timeout, parse error) still leaves an observable
 * fetch_run row with status='error', not a silently lost attempt.
 */
async function runReal(
  db: Database,
  src: IngestSource,
  deps: FetchStageDeps,
): Promise<FetchStageSourceResult> {
  const startedAt = Date.now();
  let fetchRunId: bigint | undefined;

  try {
    const allowed = await deps.isFetchAllowed(src.url, USER_AGENT, FETCH_TIMEOUT_MS);
    if (!allowed)
      return { sourceSlug: src.slug, status: 'robots_blocked', itemsSeen: 0, itemsNew: 0 };

    fetchRunId = await startFetchRun(db, src.id);
    const adapter = deps.getAdapter(src.type);
    const result = await adapter.fetch(src, { timeoutMs: FETCH_TIMEOUT_MS, userAgent: USER_AGENT });
    const rows = result.notModified ? [] : result.items.map(hashItem);
    const status: 'success' | 'skipped_not_modified' = result.notModified
      ? 'skipped_not_modified'
      : 'success';
    const itemsNew = status === 'success' ? await insertRawItems(db, src.id, fetchRunId, rows) : 0;

    await persistSuccess(db, src, {
      fetchRunId,
      startedAt,
      status,
      itemsSeen: rows.length,
      itemsNew,
      etag: result.etag,
      lastModified: result.lastModified,
    });

    return { sourceSlug: src.slug, status, itemsSeen: rows.length, itemsNew };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (fetchRunId !== undefined) {
      await finishFetchRun(db, fetchRunId, {
        status: 'error',
        httpStatus: null,
        itemsSeen: 0,
        itemsNew: 0,
        errorKind: classifyError(message),
        errorMessage: message,
        durationMs: Date.now() - startedAt,
      });
    }
    await recordFailure(db, src, message);
    return { sourceSlug: src.slug, status: 'error', itemsSeen: 0, itemsNew: 0, error: message };
  }
}

/**
 * Per-source failure isolation (invariant 7): one source throwing never
 * stops the loop over the rest.
 */
export async function runFetchStage(
  db: Database,
  options: FetchStageOptions,
  deps: FetchStageDeps = DEFAULT_DEPS,
): Promise<FetchStageSourceResult[]> {
  const sources = await listIngestSources(db, options.sourceSlug);
  const results: FetchStageSourceResult[] = [];
  for (const src of sources) {
    results.push(options.dryRun ? await runDryRun(src, deps) : await runReal(db, src, deps));
  }
  return results;
}
