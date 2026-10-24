import { foodDropExtractionSchema } from '@bitedrop/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ruleBasedProvider } from '../../src/providers/rule-based';
import * as heuristics from '../../src/providers/ruleBasedHeuristics';
import type { ExtractionInput } from '../../src/providers/ruleBasedHeuristics';

function input(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
  return {
    title: null,
    excerpt: null,
    bodyText: null,
    discoveredAt: '2026-10-24T00:00:00.000Z',
    sourceTrustTier: 2,
    knownBrandNames: ['Reese’s', 'Taco Bell'],
    ...overrides,
  };
}

async function extract(ctx: ExtractionInput) {
  const result = await ruleBasedProvider.extract({
    schema: foodDropExtractionSchema,
    prompt: 'extract',
    input: JSON.stringify(ctx),
  });
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error.message}`);
  return result.value;
}

describe('ruleBasedProvider.extract — category keywords', () => {
  const cases: [string, string][] = [
    ['New tortilla chips flavor', 'chips'],
    ['New trail mix snack', 'snacks'],
    ['New caramel candy bar', 'candy'],
    ['New ice cream dessert', 'desserts'],
    ['New energy drink flavor', 'drinks'],
    ['New burger at the drive-thru', 'fast_food'],
    ['New restaurant opens its new location downtown', 'restaurants'],
    ['New item at the 7-eleven convenience store', 'convenience'],
    ['New pumpkin spice seasonal treat', 'seasonal'],
    ['New item spotted at the grocery supermarket', 'grocery'],
  ];

  it.each(cases)('maps %j to categorySlug %j', async (title, expectedSlug) => {
    const extraction = await extract(input({ title }));
    expect(extraction.categorySlug).toBe(expectedSlug);
  });

  it('falls back to other when nothing matches', async () => {
    const extraction = await extract(input({ title: 'A completely unrelated announcement' }));
    expect(extraction.categorySlug).toBe('other');
  });
});

describe('ruleBasedProvider.extract — brand matching', () => {
  it('matches the longest known brand name, not a shorter substring', async () => {
    const extraction = await extract(
      input({
        title: 'Taco Bell launches a new menu item',
        knownBrandNames: ['Taco', 'Taco Bell'],
      }),
    );
    expect(extraction.brandName).toBe('Taco Bell');
  });

  it('is null when no known brand appears', async () => {
    const extraction = await extract(input({ title: 'A snack brand launches a new flavor' }));
    expect(extraction.brandName).toBeNull();
  });
});

describe('ruleBasedProvider.extract — status and confidence', () => {
  it('hedge language forces rumored and caps confidence at 0.4 even with other hits', async () => {
    const extraction = await extract(
      input({
        title: 'Taco Bell new burger flavor rumored for November 16, 2026',
        sourceTrustTier: 1,
        knownBrandNames: ['Taco Bell'],
      }),
    );
    expect(extraction.status).toBe('rumored');
    expect(extraction.confidence).toBeLessThanOrEqual(0.4);
  });

  it('detects returning status', async () => {
    const extraction = await extract(input({ title: 'Fan-favorite snack is back at stores' }));
    expect(extraction.status).toBe('returning');
  });

  it('detects coming_soon status', async () => {
    const extraction = await extract(input({ title: 'New burger launching soon nationwide' }));
    expect(extraction.status).toBe('coming_soon');
  });

  it('detects limited_time status and sets isLimitedTime independently', async () => {
    const extraction = await extract(input({ title: 'New limited-time candy edition at stores' }));
    expect(extraction.status).toBe('limited_time');
    expect(extraction.isLimitedTime).toBe(true);
  });

  it('defaults to new when nothing else matches', async () => {
    const extraction = await extract(input({ title: 'New snack flavor launches nationwide' }));
    expect(extraction.status).toBe('new');
  });
});

describe('ruleBasedProvider.extract — date and price', () => {
  it('extracts a real date', async () => {
    const extraction = await extract(
      input({ title: 'New sauce launches starting November 16, 2026' }),
    );
    expect(extraction.releaseDate).toBe('2026-11-16');
  });

  it('extracts a real price', async () => {
    const extraction = await extract(input({ title: 'New snack bar launch, priced at $4.99' }));
    expect(extraction.priceCents).toBe(499);
    expect(extraction.priceCurrency).toBe('USD');
  });

  it('leaves both null when absent', async () => {
    const extraction = await extract(input({ title: 'New snack flavor launches nationwide' }));
    expect(extraction.releaseDate).toBeNull();
    expect(extraction.priceCents).toBeNull();
    expect(extraction.priceCurrency).toBeNull();
  });
});

describe('ruleBasedProvider.extract — error paths', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a parse_error for invalid JSON input', async () => {
    const result = await ruleBasedProvider.extract({
      schema: foodDropExtractionSchema,
      prompt: 'extract',
      input: 'not json',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse_error');
      expect(typeof result.error.message).toBe('string');
    }
  });

  it('catches a broken heuristic output (confidence out of range) via schema.safeParse, not by inserting it', async () => {
    const valid = await extract(input({ title: 'New snack flavor launches nationwide' }));
    vi.spyOn(heuristics, 'runHeuristics').mockReturnValue({ ...valid, confidence: 1.5 });

    const result = await ruleBasedProvider.extract({
      schema: foodDropExtractionSchema,
      prompt: 'extract',
      input: JSON.stringify(input()),
    });
    expect(result.ok).toBe(false);
  });
});
