import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tsvector } from './customTypes';
import { dropStatusEnum } from './enums';
import { category } from './reference';

export const brand = pgTable(
  'brand',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    parentBrandId: uuid('parent_brand_id').references((): AnyPgColumn => brand.id),
    countryCode: char('country_code', { length: 2 }),
    websiteUrl: text('website_url'),
    logoUrl: text('logo_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('brand_normalized_trgm_idx').using('gin', table.normalizedName.op('gin_trgm_ops')),
  ],
);

export const brandAlias = pgTable(
  'brand_alias',
  {
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brand.id, { onDelete: 'cascade' }),
    normalizedAlias: text('normalized_alias').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.brandId, table.normalizedAlias] }),
    uniqueIndex('brand_alias_uniq').on(table.normalizedAlias),
  ],
);

/**
 * short_description and a NOT NULL description are two distinct required
 * fields, not one truncated from the other: FoodDropSummary.shortDescription
 * (<=140 chars, the card) and FoodDropDetail.description (full prose) serve
 * different views and shouldn't be derived from each other.
 */
export const foodDrop = pgTable(
  'food_drop',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    brandId: uuid('brand_id').references(() => brand.id),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => category.id),
    subcategory: text('subcategory'),
    shortDescription: text('short_description').notNull(),
    description: text('description').notNull().default(''),
    status: dropStatusEnum('status').notNull(),
    isLimitedTime: boolean('is_limited_time').notNull().default(false),
    releaseDate: date('release_date', { mode: 'string' }),
    availabilityStart: date('availability_start', { mode: 'string' }),
    availabilityEnd: date('availability_end', { mode: 'string' }),
    priceCents: integer('price_cents'),
    priceCurrency: char('price_currency', { length: 3 }),
    imageUrl: text('image_url'),
    imageStoredKey: text('image_stored_key'),
    confidence: real('confidence').notNull().default(0.5),
    published: boolean('published').notNull().default(false),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => foodDrop.id),
    sourceCount: integer('source_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSourceAt: timestamp('last_source_at', { withTimezone: true }),
    trendingScore: real('trending_score').notNull().default(0),
    viewCount: integer('view_count').notNull().default(0),
    // Already lowercased + diacritic-stripped by composeSearchText() before
    // insert — see packages/core/src/normalize.ts for why.
    searchText: text('search_text').notNull().default(''),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', search_text)`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Feed + sort — partial on published/non-tombstoned, per every query.
    index('food_drop_feed_idx')
      .on(table.firstSeenAt.desc(), table.id.desc())
      .where(sql`${table.published} AND ${table.mergedIntoId} IS NULL`),
    index('food_drop_trending_idx')
      .on(table.trendingScore.desc(), table.id.desc())
      .where(sql`${table.published} AND ${table.mergedIntoId} IS NULL`),
    // Filters — each composite ends in the sort key.
    index('food_drop_category_idx')
      .on(table.categoryId, table.firstSeenAt.desc())
      .where(sql`${table.published} AND ${table.mergedIntoId} IS NULL`),
    index('food_drop_brand_idx')
      .on(table.brandId, table.firstSeenAt.desc())
      .where(sql`${table.published} AND ${table.mergedIntoId} IS NULL`),
    index('food_drop_status_idx')
      .on(table.status, table.firstSeenAt.desc())
      .where(sql`${table.published} AND ${table.mergedIntoId} IS NULL`),
    // Search + fuzzy dedupe.
    index('food_drop_search_idx').using('gin', table.searchVector),
    index('food_drop_name_trgm_idx').using('gin', table.normalizedName.op('gin_trgm_ops')),
  ],
);
