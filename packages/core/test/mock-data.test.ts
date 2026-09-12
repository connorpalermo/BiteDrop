import { describe, expect, it } from 'vitest';
import { CATEGORIES, COUNTRIES } from '../src/reference';
import type { DropStatus } from '../src/types';
import { MOCK_NOW, RAW_MOCK_DROPS } from '../src/mock/data';

const ALL_STATUSES: DropStatus[] = [
  'new',
  'coming_soon',
  'limited_time',
  'returning',
  'discontinued',
  'rumored',
];

function daysBetween(iso: string, now: string): number {
  return (new Date(now).getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

describe('mock dataset coverage', () => {
  it('contains exactly 40 hand-authored drops', () => {
    expect(RAW_MOCK_DROPS).toHaveLength(40);
  });

  it('has unique ids and unique slugs', () => {
    const ids = new Set(RAW_MOCK_DROPS.map((d) => d.id));
    const slugs = new Set(RAW_MOCK_DROPS.map((d) => d.slug));
    expect(ids.size).toBe(RAW_MOCK_DROPS.length);
    expect(slugs.size).toBe(RAW_MOCK_DROPS.length);
  });

  it('covers every category at least once', () => {
    const present = new Set(RAW_MOCK_DROPS.map((d) => d.categorySlug));
    for (const category of CATEGORIES) {
      expect(present.has(category.slug)).toBe(true);
    }
  });

  it('covers every status at least once', () => {
    const present = new Set(RAW_MOCK_DROPS.map((d) => d.status));
    for (const status of ALL_STATUSES) {
      expect(present.has(status)).toBe(true);
    }
  });

  it('covers at least 5 distinct countries', () => {
    const present = new Set(RAW_MOCK_DROPS.flatMap((d) => d.countryCodes));
    expect(present.size).toBeGreaterThanOrEqual(5);
    expect(present.size).toBeLessThanOrEqual(COUNTRIES.length);
  });

  it('has at least 4 drops that are entirely non-US', () => {
    const nonUs = RAW_MOCK_DROPS.filter((d) => !d.countryCodes.includes('US'));
    expect(nonUs.length).toBeGreaterThanOrEqual(4);
  });

  it('has at least 3 drops available in 2 or more countries', () => {
    const multi = RAW_MOCK_DROPS.filter((d) => d.countryCodes.length >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(3);
  });

  it('spreads sourceCount across 1-9 with both extremes represented', () => {
    for (const drop of RAW_MOCK_DROPS) {
      expect(drop.sourceCount).toBeGreaterThanOrEqual(1);
      expect(drop.sourceCount).toBeLessThanOrEqual(9);
    }
    expect(RAW_MOCK_DROPS.some((d) => d.sourceCount === 1)).toBe(true);
    expect(RAW_MOCK_DROPS.some((d) => d.sourceCount >= 5)).toBe(true);
  });

  it('spreads firstSeenAt across every relative-time bucket, relative to MOCK_NOW', () => {
    const days = RAW_MOCK_DROPS.map((d) => daysBetween(d.firstSeenAt, MOCK_NOW));
    expect(days.some((d) => d < 1 / 24)).toBe(true); // minutes ago (< 1 hour)
    expect(days.some((d) => d >= 1 / 24 && d < 1)).toBe(true); // hours ago
    expect(days.some((d) => d >= 1 && d < 7)).toBe(true); // days ago
    expect(days.some((d) => d >= 7 && d < 35)).toBe(true); // weeks ago
    expect(days.some((d) => d >= 60)).toBe(true); // more than 2 months ago
  });

  it('has at least 2 drops with each nullable field null', () => {
    const nullCounts = {
      imageUrl: RAW_MOCK_DROPS.filter((d) => d.imageUrl === null).length,
      priceCents: RAW_MOCK_DROPS.filter((d) => d.priceCents === null).length,
      retailers: RAW_MOCK_DROPS.filter((d) => d.retailerSlugs.length === 0).length,
      brand: RAW_MOCK_DROPS.filter((d) => d.brand === null).length,
      releaseDate: RAW_MOCK_DROPS.filter((d) => d.releaseDate === null).length,
      subcategory: RAW_MOCK_DROPS.filter((d) => d.subcategory === null).length,
    };
    for (const [field, count] of Object.entries(nullCounts)) {
      expect(count, `expected >= 2 drops with ${field} null/empty`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every firstSeenAt is a valid, parseable ISO literal', () => {
    for (const drop of RAW_MOCK_DROPS) {
      expect(Number.isNaN(new Date(drop.firstSeenAt).getTime())).toBe(false);
    }
  });
});
