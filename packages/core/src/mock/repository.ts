import {
  CATEGORIES,
  COUNTRIES,
  findCategory,
  findCountry,
  findRetailer,
  findStatusLabel,
  STATUSES,
} from '../reference';
import { decodeCursor, encodeCursor, type FeedQuery, type FoodDropRepository } from '../repository';
import type { Facets, FacetCount, FoodDropDetail, FoodDropSummary, Page } from '../types';
import { RAW_MOCK_DROPS, sourcesFor, type RawMockDrop } from './data';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function toSummary(raw: RawMockDrop): FoodDropSummary {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    brand: raw.brand,
    category: findCategory(raw.categorySlug),
    subcategory: raw.subcategory,
    shortDescription: raw.shortDescription,
    status: raw.status,
    isLimitedTime: raw.isLimitedTime,
    releaseDate: raw.releaseDate,
    availabilityStart: raw.availabilityStart,
    availabilityEnd: raw.availabilityEnd,
    priceCents: raw.priceCents,
    priceCurrency: raw.priceCurrency,
    imageUrl: raw.imageUrl,
    countries: raw.countryCodes.map((code) => findCountry(code)),
    retailers: raw.retailerSlugs.map((slug) => findRetailer(slug)),
    sourceCount: raw.sourceCount,
    firstSeenAt: raw.firstSeenAt,
    trendingScore: raw.trendingScore,
  };
}

function matchesCategory(summary: FoodDropSummary, q: FeedQuery): boolean {
  return !q.categories?.length || q.categories.includes(summary.category.slug);
}

function matchesCountry(summary: FoodDropSummary, q: FeedQuery): boolean {
  if (!q.countries?.length) return true;
  const codes = summary.countries.map((c) => c.code);
  return q.countries.some((c) => codes.includes(c));
}

function matchesStatus(summary: FoodDropSummary, q: FeedQuery): boolean {
  return !q.statuses?.length || q.statuses.includes(summary.status);
}

function matchesBrand(summary: FoodDropSummary, q: FeedQuery): boolean {
  if (!q.brandSlugs?.length) return true;
  return summary.brand !== null && q.brandSlugs.includes(summary.brand.slug);
}

function matchesSearch(summary: FoodDropSummary, q: FeedQuery): boolean {
  const search = q.search?.trim();
  if (!search) return true;
  const needle = normalize(search);
  const haystacks = [
    summary.name,
    summary.brand?.name ?? '',
    summary.shortDescription,
    summary.subcategory ?? '',
  ];
  return haystacks.some((h) => normalize(h).includes(needle));
}

function matchesQuery(summary: FoodDropSummary, q: FeedQuery): boolean {
  return (
    matchesCategory(summary, q) &&
    matchesCountry(summary, q) &&
    matchesStatus(summary, q) &&
    matchesBrand(summary, q) &&
    matchesSearch(summary, q)
  );
}

/** Ascending comparator on the (sortValue, id) tuple used for both ordering and cursoring. */
function tupleCompare(
  aVal: string | number,
  aId: string,
  bVal: string | number,
  bId: string,
): number {
  if (aVal < bVal) return -1;
  if (aVal > bVal) return 1;
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

interface Keyed {
  summary: FoodDropSummary;
  sortValue: string | number;
}

function buildFacetCounts<T, V extends string>(
  canonical: readonly T[],
  valueOf: (t: T) => V,
  labelOf: (t: T) => string,
  counts: Map<string, number>,
): FacetCount<V>[] {
  return canonical.map((t) => ({
    value: valueOf(t),
    label: labelOf(t),
    count: counts.get(valueOf(t)) ?? 0,
  }));
}

export class MockFoodDropRepository implements FoodDropRepository {
  private readonly raw: readonly RawMockDrop[];

  constructor(raw: readonly RawMockDrop[] = RAW_MOCK_DROPS) {
    this.raw = raw;
  }

  // async (with no internal await) so a thrown InvalidCursorError becomes a
  // rejected promise, matching how a real DB-backed implementation would fail —
  // a plain function would let it escape as a synchronous throw instead.
  // eslint-disable-next-line @typescript-eslint/require-await
  async list(q: FeedQuery): Promise<Page<FoodDropSummary>> {
    const keyed: Keyed[] = this.raw
      .map((r) => toSummary(r))
      .filter((summary) => matchesQuery(summary, q))
      .map((summary) => ({
        summary,
        sortValue: q.sort === 'trending' ? summary.trendingScore : summary.firstSeenAt,
      }));

    keyed.sort((a, b) => -tupleCompare(a.sortValue, a.summary.id, b.sortValue, b.summary.id));

    let startIndex = 0;
    if (q.cursor) {
      const { v: cursorValue, id: cursorId } = decodeCursor(q.cursor);
      const idx = keyed.findIndex(
        (k) => tupleCompare(k.sortValue, k.summary.id, cursorValue, cursorId) < 0,
      );
      startIndex = idx === -1 ? keyed.length : idx;
    }

    const page = keyed.slice(startIndex, startIndex + q.limit);
    const hasMore = startIndex + q.limit < keyed.length;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ v: last.sortValue, id: last.summary.id }) : null;

    return { items: page.map((k) => k.summary), nextCursor };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- see list() above
  async getBySlug(slug: string): Promise<FoodDropDetail | null> {
    const raw = this.raw.find((r) => r.slug === slug);
    if (!raw) return null;

    const summary = toSummary(raw);
    const others = this.raw.filter((r) => r.id !== raw.id).map((r) => toSummary(r));
    const byRecency = (a: FoodDropSummary, b: FoodDropSummary) =>
      b.firstSeenAt.localeCompare(a.firstSeenAt);

    const relatedBySameBrand = raw.brand
      ? others
          .filter((s) => s.brand?.slug === raw.brand?.slug)
          .sort(byRecency)
          .slice(0, 4)
      : [];
    const relatedBySameCategory = others
      .filter((s) => s.category.slug === summary.category.slug)
      .sort(byRecency)
      .slice(0, 4);

    return {
      ...summary,
      description: raw.description,
      confidence: raw.confidence,
      sources: sourcesFor(raw),
      relatedBySameBrand,
      relatedBySameCategory,
    };
  }

  async facets(): Promise<Facets> {
    const summaries = this.raw.map((r) => toSummary(r));

    const categoryCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();
    const brandCounts = new Map<string, number>();
    const brandNames = new Map<string, string>();

    for (const s of summaries) {
      categoryCounts.set(s.category.slug, (categoryCounts.get(s.category.slug) ?? 0) + 1);
      statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
      for (const c of s.countries) {
        countryCounts.set(c.code, (countryCounts.get(c.code) ?? 0) + 1);
      }
      if (s.brand) {
        brandCounts.set(s.brand.slug, (brandCounts.get(s.brand.slug) ?? 0) + 1);
        brandNames.set(s.brand.slug, s.brand.name);
      }
    }

    const brands: FacetCount<string>[] = Array.from(brandCounts.entries())
      .map(([slug, count]) => ({ value: slug, label: brandNames.get(slug) ?? slug, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return Promise.resolve({
      categories: buildFacetCounts(
        CATEGORIES,
        (c) => c.slug,
        (c) => c.name,
        categoryCounts,
      ),
      countries: buildFacetCounts(
        COUNTRIES,
        (c) => c.code,
        (c) => c.name,
        countryCounts,
      ),
      statuses: buildFacetCounts(
        STATUSES,
        (s) => s.value,
        (s) => findStatusLabel(s.value),
        statusCounts,
      ),
      brands,
    });
  }
}
