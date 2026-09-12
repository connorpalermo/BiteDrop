import { CATEGORIES, COUNTRIES, STATUSES } from './reference';
import type { FeedQuery } from './repository';
import type { CategorySlug, CountryCode, DropStatus } from './types';

/**
 * The plain shape Next.js hands a Server Component's `searchParams` prop, and
 * what `URLSearchParams` produces client-side — deliberately not a Next-specific
 * type, so this stays framework-agnostic per S7's note that Phase 2 reuses the
 * same contract server-side.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const CATEGORY_SLUGS = new Set<string>(CATEGORIES.map((c) => c.slug));
const COUNTRY_CODES = new Set<string>(COUNTRIES.map((c) => c.code));
const STATUS_VALUES = new Set<string>(STATUSES.map((s) => s.value));

function firstValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseValidatedList<T extends string>(
  raw: string | string[] | undefined,
  valid: ReadonlySet<string>,
): T[] | undefined {
  const value = firstValue(raw);
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => valid.has(s)) as T[];
  return items.length > 0 ? items : undefined;
}

function parseRawList(raw: string | string[] | undefined): string[] | undefined {
  const value = firstValue(raw);
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/** Parses URL search params into a FeedQuery per the S7 contract. Unknown
 * category/country/status values are silently dropped, never an error. */
export function parseFeedQuery(params: RawSearchParams, limit: number): FeedQuery {
  const search = firstValue(params.q);
  return {
    limit,
    sort: firstValue(params.sort) === 'trending' ? 'trending' : 'newest',
    categories: parseValidatedList<CategorySlug>(params.category, CATEGORY_SLUGS),
    countries: parseValidatedList<CountryCode>(params.country, COUNTRY_CODES),
    statuses: parseValidatedList<DropStatus>(params.status, STATUS_VALUES),
    brandSlugs: parseRawList(params.brand),
    search: search && search.trim() ? search : undefined,
  };
}

/** Inverse of parseFeedQuery — the S7 contract's param names, comma-joined,
 * omitted entirely when unconstrained (never an empty `?category=`). */
export function feedQueryToSearchParams(query: FeedQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.categories?.length) params.set('category', query.categories.join(','));
  if (query.countries?.length) params.set('country', query.countries.join(','));
  if (query.statuses?.length) params.set('status', query.statuses.join(','));
  if (query.brandSlugs?.length) params.set('brand', query.brandSlugs.join(','));
  if (query.search?.trim()) params.set('q', query.search.trim());
  if (query.sort === 'trending') params.set('sort', 'trending');
  return params;
}
