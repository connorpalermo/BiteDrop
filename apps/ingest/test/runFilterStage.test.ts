import { createHash } from 'node:crypto';
import { schema } from '@bitedrop/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { runFilterStage } from '../src/runFilterStage';
import { getTestDb, resetTestDb } from './testDb';

const { rawItem, source } = schema;

function hashUrl(url: string): Buffer {
  return createHash('sha256').update(url).digest();
}

async function insertDiscovered(sourceSlug: string, url: string, title: string): Promise<string> {
  const db = getTestDb();
  const [src] = await db.select({ id: source.id }).from(source).where(eq(source.slug, sourceSlug));
  const [row] = await db
    .insert(rawItem)
    .values({ sourceId: src!.id, url, urlHash: hashUrl(url), title, stage: 'discovered' })
    .returning({ id: rawItem.id });
  return row!.id;
}

describe('runFilterStage', () => {
  beforeEach(async () => {
    await resetTestDb();
  }, 30_000);

  it('moves a real food-signal title to candidate', async () => {
    const id = await insertDiscovered(
      'brandeating-rss',
      'https://example.com/1',
      'Chick-fil-A Unveils New Spicy Chick-fil-A Sauce',
    );
    const result = await runFilterStage(getTestDb(), { dryRun: false });
    expect(result.passed).toBeGreaterThanOrEqual(1);

    const [row] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, id));
    expect(row!.stage).toBe('candidate');
  });

  it('rejects a real noise title with the correct reason', async () => {
    const id = await insertDiscovered(
      'prnewswire-rss',
      'https://example.com/2',
      'World Young Scientist Summit 2026 Opens in Wenzhou, Zhejiang',
    );
    await runFilterStage(getTestDb(), { dryRun: false });

    const [row] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, id));
    expect(row!.stage).toBe('rejected');
    expect(row!.filterReason).toBe('no_food_signal');
  });

  it('--dry-run leaves raw_item.stage unchanged', async () => {
    const id = await insertDiscovered(
      'brandeating-rss',
      'https://example.com/3',
      'New limited-time snack launches nationwide',
    );
    await runFilterStage(getTestDb(), { dryRun: true });

    const [row] = await getTestDb().select().from(rawItem).where(eq(rawItem.id, id));
    expect(row!.stage).toBe('discovered');
  });

  it('--source scopes to one source only', async () => {
    await insertDiscovered('brandeating-rss', 'https://example.com/4', 'New snack launches');
    await insertDiscovered('prnewswire-rss', 'https://example.com/5', 'New snack launches too');

    const result = await runFilterStage(getTestDb(), {
      sourceSlug: 'brandeating-rss',
      dryRun: false,
    });
    expect(result.seen).toBe(1);
  });
});
