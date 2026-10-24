import { applyFilter } from '@bitedrop/core';
import { applyFilterVerdicts, listDiscoveredRawItems, type Database } from '@bitedrop/db';
import { resolveSourceId } from './resolveSourceId';

export interface FilterStageResult {
  seen: number;
  passed: number;
  rejected: number;
  reasonCounts: Record<string, number>;
}

export async function runFilterStage(
  db: Database,
  options: { sourceSlug?: string; dryRun: boolean },
): Promise<FilterStageResult> {
  const sourceId = await resolveSourceId(db, options.sourceSlug);
  const items = await listDiscoveredRawItems(db, sourceId);

  const reasonCounts: Record<string, number> = {};
  const verdicts = items.map((item) => {
    const verdict = applyFilter(item);
    if (!verdict.passed && verdict.reason) {
      reasonCounts[verdict.reason] = (reasonCounts[verdict.reason] ?? 0) + 1;
    }
    return { rawItemId: item.id, passed: verdict.passed, reason: verdict.reason };
  });

  if (!options.dryRun) {
    await applyFilterVerdicts(db, verdicts);
  }

  const passed = verdicts.filter((v) => v.passed).length;
  return { seen: items.length, passed, rejected: items.length - passed, reasonCounts };
}
