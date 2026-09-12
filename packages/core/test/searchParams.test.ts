import { describe, expect, it } from 'vitest';
import type { FeedQuery } from '../src/repository';
import { feedQueryToSearchParams, parseFeedQuery } from '../src/searchParams';

describe('parseFeedQuery', () => {
  it('defaults sort to newest when absent', () => {
    expect(parseFeedQuery({}, 12).sort).toBe('newest');
  });

  it('uses trending only for the exact literal value', () => {
    expect(parseFeedQuery({ sort: 'trending' }, 12).sort).toBe('trending');
    expect(parseFeedQuery({ sort: 'Trending' }, 12).sort).toBe('newest');
    expect(parseFeedQuery({ sort: 'oldest' }, 12).sort).toBe('newest');
  });

  it('splits and trims a comma-separated category list', () => {
    const q = parseFeedQuery({ category: 'candy, chips ,snacks' }, 12);
    expect(q.categories).toEqual(['candy', 'chips', 'snacks']);
  });

  it('silently drops unknown category values rather than erroring', () => {
    const q = parseFeedQuery({ category: 'candy,not-a-real-category' }, 12);
    expect(q.categories).toEqual(['candy']);
  });

  it('drops the whole field to undefined when every value is unknown', () => {
    const q = parseFeedQuery({ category: 'nonsense' }, 12);
    expect(q.categories).toBeUndefined();
  });

  it('validates country codes and status values the same way', () => {
    const q = parseFeedQuery({ country: 'US,JP,XX', status: 'new,rumored,bogus' }, 12);
    expect(q.countries).toEqual(['US', 'JP']);
    expect(q.statuses).toEqual(['new', 'rumored']);
  });

  it('leaves category/country/status/brand/search undefined when absent', () => {
    const q = parseFeedQuery({}, 12);
    expect(q.categories).toBeUndefined();
    expect(q.countries).toBeUndefined();
    expect(q.statuses).toBeUndefined();
    expect(q.brandSlugs).toBeUndefined();
    expect(q.search).toBeUndefined();
  });

  it('does not validate brand slugs against a closed set — brand is open-ended', () => {
    const q = parseFeedQuery({ brand: 'oreo,some-future-brand' }, 12);
    expect(q.brandSlugs).toEqual(['oreo', 'some-future-brand']);
  });

  it('treats an empty or whitespace-only q as absent', () => {
    expect(parseFeedQuery({ q: '' }, 12).search).toBeUndefined();
    expect(parseFeedQuery({ q: '   ' }, 12).search).toBeUndefined();
  });

  it('keeps a real search string as-is', () => {
    expect(parseFeedQuery({ q: 'pickle' }, 12).search).toBe('pickle');
  });

  it('takes the first value when a param is repeated (array form)', () => {
    const q = parseFeedQuery({ category: ['candy', 'chips'] }, 12);
    expect(q.categories).toEqual(['candy']);
  });

  it('always sets the given limit', () => {
    expect(parseFeedQuery({}, 24).limit).toBe(24);
  });
});

describe('feedQueryToSearchParams', () => {
  it('omits every param entirely when unconstrained, never an empty key', () => {
    const params = feedQueryToSearchParams({ limit: 12, sort: 'newest' });
    expect(params.toString()).toBe('');
  });

  it('joins multiple values with a comma', () => {
    const params = feedQueryToSearchParams({
      limit: 12,
      sort: 'newest',
      categories: ['candy', 'chips'],
    });
    expect(params.get('category')).toBe('candy,chips');
  });

  it('sets sort only for trending, never for the newest default', () => {
    expect(feedQueryToSearchParams({ limit: 12, sort: 'newest' }).has('sort')).toBe(false);
    expect(feedQueryToSearchParams({ limit: 12, sort: 'trending' }).get('sort')).toBe('trending');
  });

  it('trims search before setting q', () => {
    const params = feedQueryToSearchParams({ limit: 12, sort: 'newest', search: '  pickle  ' });
    expect(params.get('q')).toBe('pickle');
  });

  it('omits q for an empty or whitespace-only search', () => {
    expect(feedQueryToSearchParams({ limit: 12, sort: 'newest', search: '' }).has('q')).toBe(false);
    expect(feedQueryToSearchParams({ limit: 12, sort: 'newest', search: '  ' }).has('q')).toBe(
      false,
    );
  });

  it('round-trips through parse and back to an equivalent query', () => {
    const original: FeedQuery = {
      limit: 12,
      sort: 'trending',
      categories: ['candy', 'chips'],
      countries: ['US', 'JP'],
      statuses: ['new'],
      brandSlugs: ['oreo'],
      search: 'halloween',
    };
    const params = feedQueryToSearchParams(original);
    const rawParams: Record<string, string> = {};
    params.forEach((value, key) => {
      rawParams[key] = value;
    });
    const roundTripped = parseFeedQuery(rawParams, 12);
    expect(roundTripped).toEqual(original);
  });
});
