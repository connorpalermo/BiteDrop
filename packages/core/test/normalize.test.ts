import { describe, expect, it } from 'vitest';
import {
  buildTsQuery,
  canonicalizeUrl,
  composeSearchText,
  normalizeName,
  normalizeText,
} from '../src/normalize';

describe('normalizeText', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeText('Crème')).toBe('creme');
  });

  it('leaves plain ascii lowercase text unchanged', () => {
    expect(normalizeText('taco bell')).toBe('taco bell');
  });
});

describe('normalizeName', () => {
  it('strips punctuation in addition to normalizeText', () => {
    expect(normalizeName("Reese's")).toBe('reeses');
  });

  it('collapses internal whitespace and trims', () => {
    expect(normalizeName('  Ben  &  Jerry’s  ')).toBe('ben jerrys');
  });
});

describe('composeSearchText', () => {
  it('includes name, brand, subcategory, description, and retailers, fully normalised', () => {
    const text = composeSearchText({
      name: 'Crème Brûlée Bar',
      brandName: 'Magnum',
      subcategory: 'Ice Cream',
      description: 'A rich dessert.',
      retailerNames: ['Target', 'Walmart'],
    });
    expect(text).toBe('creme brulee bar magnum ice cream a rich dessert. target walmart');
  });

  it('handles null brand and subcategory and empty retailers', () => {
    const text = composeSearchText({
      name: 'Mystery Snack',
      brandName: null,
      subcategory: null,
      description: 'Unknown origin.',
      retailerNames: [],
    });
    expect(text).toBe('mystery snack unknown origin.');
  });
});

describe('buildTsQuery', () => {
  it('appends :* to a single token', () => {
    expect(buildTsQuery('pick')).toBe('pick:*');
  });

  it('joins multiple tokens with & and only prefixes the last', () => {
    expect(buildTsQuery('taco bell')).toBe('taco & bell:*');
  });

  it('strips every tsquery metacharacter', () => {
    expect(buildTsQuery("a&b|c!d(e)f:g*h'i")).toBe('a & b & c & d & e & f & g & h & i:*');
  });

  it('returns null for an empty string', () => {
    expect(buildTsQuery('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(buildTsQuery('   ')).toBeNull();
  });

  it('returns null when only metacharacters are given', () => {
    expect(buildTsQuery('!!!')).toBeNull();
  });

  it('is case- and diacritic-insensitive', () => {
    expect(buildTsQuery('CRÈME')).toBe('creme:*');
  });
});

describe('canonicalizeUrl', () => {
  it('strips utm_* query params', () => {
    expect(canonicalizeUrl('https://example.com/a?utm_source=rss&utm_medium=feed')).toBe(
      'https://example.com/a',
    );
  });

  it('strips the fragment', () => {
    expect(canonicalizeUrl('https://example.com/a#section-2')).toBe('https://example.com/a');
  });

  it('sorts remaining query params by key', () => {
    expect(canonicalizeUrl('https://example.com/a?b=2&a=1')).toBe('https://example.com/a?a=1&b=2');
  });

  it('two URLs differing only in tracking params, query order, and fragment canonicalise identically', () => {
    const a = canonicalizeUrl('https://example.com/a?utm_source=rss&b=2&a=1#x');
    const b = canonicalizeUrl('https://example.com/a?a=1&utm_campaign=foo&b=2');
    expect(a).toBe(b);
  });

  it('leaves a non-utm query param that merely starts similarly untouched', () => {
    expect(canonicalizeUrl('https://example.com/a?utmost=1')).toBe(
      'https://example.com/a?utmost=1',
    );
  });
});
