import {
  buildTsQuery,
  decodeCursor,
  encodeCursor,
  normalizeName,
  type FeedQuery,
  type FoodDropSummary,
  type Page,
  type SortKey,
} from '@bitedrop/core';
import { and, desc, eq, exists, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { brand, category, foodDrop, foodDropCountry } from '../schema/index';
import { loadChildren } from './childLoaders';
import { baseFeedWhere, summaryColumns, toSummary, type SummaryRow } from './rowMappers';

/**
 * Must be EXISTS, not a join — a drop matching two of the requested
 * countries would otherwise be joined twice and appear twice in the page,
 * corrupting both the page size and the cursor.
 *
 * Built with drizzle's typed `exists()` + `inArray()` rather than a raw
 * `= ANY(${countries})` SQL template — postgres.js doesn't reliably
 * serialise a JS array interpolated into a raw `sql` template as a Postgres
 * array literal (a one-element array silently unwrapped to its bare scalar,
 * producing `malformed array literal` for a real single-country filter).
 * The typed helpers parameterise correctly.
 */
function countryFilter(db: Database, countries: string[]): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(foodDropCountry)
      .where(
        and(
          eq(foodDropCountry.foodDropId, foodDrop.id),
          inArray(foodDropCountry.countryCode, countries),
        ),
      ),
  );
}

/**
 * The trigram arm is the typo-tolerant fallback (e.g. "Oreo" <-> "Oreoo");
 * 0.3 is pg_trgm's default similarity threshold.
 *
 * Uses `word_similarity(needle, haystack)`, not plain `similarity()` — a
 * short query compared against a whole multi-word `normalized_name` (e.g.
 * "reeses" vs "reeses caramel apple cups") scores low under whole-string
 * `similarity()` even for an exact word match, because the score is diluted
 * by every word the query never claimed to match (measured: 0.28, under
 * threshold, for that exact case). `word_similarity()` instead scores the
 * query against its best-matching word-boundary substring, which is what
 * "typo-tolerant" actually needs once a name has more than one word.
 */
function searchFilter(search: string): SQL | null {
  const tsq = buildTsQuery(search);
  if (!tsq) return null;
  const normalized = normalizeName(search);
  return sql`(
    ${foodDrop.searchVector} @@ to_tsquery('english', ${tsq})
    OR word_similarity(${normalized}, ${foodDrop.normalizedName}) > 0.3
  )`;
}

function buildFilters(db: Database, q: FeedQuery): SQL[] {
  const clauses: SQL[] = [];
  if (q.categories?.length) clauses.push(inArray(category.slug, q.categories));
  if (q.statuses?.length) clauses.push(inArray(foodDrop.status, q.statuses));
  if (q.brandSlugs?.length) clauses.push(inArray(brand.slug, q.brandSlugs));
  if (q.countries?.length) clauses.push(countryFilter(db, q.countries));
  const search = q.search?.trim();
  if (search) {
    const clause = searchFilter(search);
    if (clause) clauses.push(clause);
  }
  return clauses;
}

function sortOrder(sort: SortKey): SQL[] {
  return sort === 'trending'
    ? [desc(foodDrop.trendingScore), desc(foodDrop.id)]
    : [desc(foodDrop.firstSeenAt), desc(foodDrop.id)];
}

/** Postgres row comparison `(a, b) < (c, d)` — matched by the planner against
 * the composite feed/trending index, and harder to get wrong than the
 * hand-expanded `a < c OR (a = c AND b < d)` form. */
function cursorPredicate(sort: SortKey, cursor: string): SQL {
  const { v, id } = decodeCursor(cursor); // throws InvalidCursorError on malformed input
  return sort === 'trending'
    ? sql`(${foodDrop.trendingScore}, ${foodDrop.id}) < (${v}::real, ${id}::uuid)`
    : sql`(${foodDrop.firstSeenAt}, ${foodDrop.id}) < (${v}::timestamptz, ${id}::uuid)`;
}

function sortValueOf(sort: SortKey, row: SummaryRow): string | number {
  return sort === 'trending' ? row.trendingScore : row.firstSeenAt.toISOString();
}

export async function listFoodDrops(db: Database, q: FeedQuery): Promise<Page<FoodDropSummary>> {
  const clauses: SQL[] = [baseFeedWhere(), ...buildFilters(db, q)];
  if (q.cursor) clauses.push(cursorPredicate(q.sort, q.cursor));

  const rows: SummaryRow[] = await db
    .select(summaryColumns)
    .from(foodDrop)
    .innerJoin(category, eq(category.id, foodDrop.categoryId))
    .leftJoin(brand, eq(brand.id, foodDrop.brandId))
    .where(and(...clauses))
    .orderBy(...sortOrder(q.sort))
    .limit(q.limit + 1);

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  if (page.length === 0) return { items: [], nextCursor: null };

  const children = await loadChildren(
    db,
    page.map((r) => r.id),
  );
  const items = page.map((row) => toSummary(row, children));

  const last = page[page.length - 1]!;
  const nextCursor = hasMore ? encodeCursor({ v: sortValueOf(q.sort, last), id: last.id }) : null;

  return { items, nextCursor };
}
