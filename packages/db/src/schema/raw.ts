import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './customTypes';
import { fetchStatusEnum, itemStageEnum, sourceTypeEnum } from './enums';

export const source = pgTable('source', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  // UNIQUE — the seed resolves publications by name, and without this a
  // re-run could create duplicate sources.
  name: text('name').notNull().unique(),
  type: sourceTypeEnum('type').notNull(),
  url: text('url').notNull(),
  homepageUrl: text('homepage_url'),
  enabled: boolean('enabled').notNull().default(true),
  fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(60),
  config: jsonb('config').notNull().default({}),
  trustTier: integer('trust_tier').notNull().default(2),
  defaultCountry: char('default_country', { length: 2 }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastError: text('last_error'),
  httpEtag: text('http_etag'),
  httpLastModified: text('http_last_modified'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fetchRun = pgTable(
  'fetch_run',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: fetchStatusEnum('status').notNull(),
    httpStatus: integer('http_status'),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    errorKind: text('error_kind'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
  },
  (table) => [index('fetch_run_source_time_idx').on(table.sourceId, table.startedAt.desc())],
);

export const rawItem = pgTable(
  'raw_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade' }),
    fetchRunId: bigint('fetch_run_id', { mode: 'bigint' }).references(() => fetchRun.id, {
      onDelete: 'set null',
    }),
    url: text('url').notNull(),
    urlHash: bytea('url_hash').notNull(),
    contentHash: bytea('content_hash'),
    title: text('title'),
    author: text('author'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    excerpt: text('excerpt'),
    bodyText: text('body_text'),
    imageUrl: text('image_url'),
    rawPayload: jsonb('raw_payload'),
    stage: itemStageEnum('stage').notNull().default('discovered'),
    filterReason: text('filter_reason'),
    relevanceScore: real('relevance_score'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
  },
  (table) => [
    unique('raw_item_source_url_uniq').on(table.sourceId, table.urlHash),
    index('raw_item_url_hash_idx').on(table.urlHash),
    index('raw_item_content_hash_idx')
      .on(table.contentHash)
      .where(sql`${table.contentHash} IS NOT NULL`),
    index('raw_item_queue_idx')
      .on(table.stage, table.discoveredAt)
      .where(sql`${table.stage} IN ('discovered', 'candidate')`),
  ],
);
