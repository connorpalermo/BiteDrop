import { listIngestSources, type Database } from '@bitedrop/db';

/** Resolves --source's slug to the source's id, for stages that scope a
 * single-source raw_item query rather than iterating sources themselves. */
export async function resolveSourceId(
  db: Database,
  sourceSlug?: string,
): Promise<string | undefined> {
  if (!sourceSlug) return undefined;
  const [matched] = await listIngestSources(db, sourceSlug);
  return matched?.id;
}
