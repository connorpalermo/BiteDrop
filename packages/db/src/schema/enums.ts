import { pgEnum } from 'drizzle-orm/pg-core';

export const sourceTypeEnum = pgEnum('source_type', [
  'rss',
  'json_api',
  'html_listing',
  'reddit',
  'youtube',
]);

export const fetchStatusEnum = pgEnum('fetch_status', [
  'success',
  'partial',
  'error',
  'skipped_not_modified',
]);

// item_stage's members beyond discovered/candidate are provisional — Phase 4
// owns the pipeline and may revise them.
export const itemStageEnum = pgEnum('item_stage', [
  'discovered',
  'candidate',
  'rejected',
  'extracted',
  'linked',
  'failed',
]);

// Must stay exactly dropStatusSchema's members, in the same order — asserted
// in packages/db/test/schema.test.ts.
export const dropStatusEnum = pgEnum('drop_status', [
  'new',
  'coming_soon',
  'limited_time',
  'returning',
  'discontinued',
  'rumored',
]);

export const sourceRoleEnum = pgEnum('source_role', ['primary', 'corroborating']);

export const linkMethodEnum = pgEnum('link_method', [
  'exact_url',
  'content_hash',
  'name_brand',
  'fuzzy',
  'llm',
  'manual',
]);

export const retailerTypeEnum = pgEnum('retailer_type', [
  'grocery',
  'convenience',
  'pharmacy',
  'mass',
  'restaurant',
  'online',
]);
