import { createHash } from 'node:crypto';
import { schema } from '@bitedrop/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { runExtractStage } from '../src/runExtractStage';
import { getTestDb, resetTestDb } from './testDb';

const { foodDrop, foodDropSource, rawItem, source } = schema;

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

async function insertCandidate(
  sourceSlug: string,
  url: string,
  title: string | null,
): Promise<string> {
  const db = getTestDb();
  const [src] = await db.select({ id: source.id }).from(source).where(eq(source.slug, sourceSlug));
  const [row] = await db
    .insert(rawItem)
    .values({ sourceId: src!.id, url, urlHash: hashUrl(url), title, stage: 'candidate' })
    .returning({ id: rawItem.id });
  return row!.id;
}

describe('runExtractStage', () => {
  beforeEach(async () => {
    await resetTestDb();
  }, 30_000);

  it('creates exactly one food_drop and links the raw_item', async () => {
    const id = await insertCandidate(
      'brandeating-rss',
      'https://example.com/1',
      'Chick-fil-A Unveils New Spicy Chick-fil-A Sauce',
    );
    const result = await runExtractStage(getTestDb(), { dryRun: false });
    expect(result.created).toBeGreaterThanOrEqual(1);

    const [row] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, id));
    expect(row!.stage).toBe('linked');
  });

  it('per-item isolation: a candidate with no title fails extraction without blocking the next one', async () => {
    const failingId = await insertCandidate('brandeating-rss', 'https://example.com/2', null);
    const okId = await insertCandidate(
      'prnewswire-rss',
      'https://example.com/3',
      'New Spicy Taco Bell Sauce Launches Nationwide',
    );

    const result = await runExtractStage(getTestDb(), { dryRun: false });
    expect(result.failures.some((f) => f.rawItemId === failingId)).toBe(true);

    const [failingRow] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, failingId));
    const [okRow] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, okId));
    expect(failingRow!.stage).toBe('failed');
    expect(failingRow!.lastError).not.toBeNull();
    expect(okRow!.stage).toBe('linked');
  });

  it('--dry-run creates no food_drop and leaves raw_item.stage unchanged', async () => {
    const id = await insertCandidate(
      'brandeating-rss',
      'https://example.com/4',
      'New Spicy Sauce Launches',
    );
    const before = (await getTestDb().select().from(foodDrop)).length;

    await runExtractStage(getTestDb(), { dryRun: true });

    const after = (await getTestDb().select().from(foodDrop)).length;
    expect(after).toBe(before);

    const [row] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, id));
    expect(row!.stage).toBe('candidate');
  });

  it('dedupe: two candidates with the same canonical URL link to one food_drop, not two', async () => {
    await insertCandidate(
      'brandeating-rss',
      'https://example.com/shared-article',
      'New Spicy Sauce Launches Nationwide',
    );
    await insertCandidate(
      'prnewswire-rss',
      'https://example.com/shared-article',
      'New Spicy Sauce Launches Nationwide',
    );

    const result = await runExtractStage(getTestDb(), { dryRun: false });
    expect(result.created).toBe(1);
    expect(result.linked).toBe(1);

    const drops = await getTestDb()
      .select()
      .from(foodDrop)
      .where(eq(foodDrop.name, 'New Spicy Sauce Launches Nationwide'));
    expect(drops).toHaveLength(1);

    const sources = await getTestDb()
      .select()
      .from(foodDropSource)
      .where(eq(foodDropSource.foodDropId, drops[0]!.id));
    expect(sources).toHaveLength(2);
  });

  it('--source scopes to one source only', async () => {
    await insertCandidate('brandeating-rss', 'https://example.com/5', 'New snack launches');
    await insertCandidate('prnewswire-rss', 'https://example.com/6', 'New snack launches too');

    const result = await runExtractStage(getTestDb(), {
      sourceSlug: 'brandeating-rss',
      dryRun: false,
    });
    expect(result.seen).toBe(1);
  });
});
