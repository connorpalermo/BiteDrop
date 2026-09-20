import {
  bigserial,
  boolean,
  char,
  index,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { linkMethodEnum, sourceRoleEnum } from './enums';
import { country, retailer } from './reference';
import { foodDrop } from './canonical';
import { rawItem, source } from './raw';

export const foodDropSource = pgTable(
  'food_drop_source',
  {
    foodDropId: uuid('food_drop_id')
      .notNull()
      .references(() => foodDrop.id, { onDelete: 'cascade' }),
    rawItemId: uuid('raw_item_id')
      .notNull()
      .references(() => rawItem.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => source.id),
    role: sourceRoleEnum('role').notNull().default('corroborating'),
    linkMethod: linkMethodEnum('link_method').notNull(),
    linkConfidence: real('link_confidence').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.foodDropId, table.rawItemId] }),
    index('food_drop_source_raw_idx').on(table.rawItemId),
  ],
);

export const foodDropCountry = pgTable(
  'food_drop_country',
  {
    foodDropId: uuid('food_drop_id')
      .notNull()
      .references(() => foodDrop.id, { onDelete: 'cascade' }),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => country.code),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.foodDropId, table.countryCode] }),
    index('food_drop_country_lookup_idx').on(table.countryCode, table.foodDropId),
  ],
);

export const foodDropRetailer = pgTable(
  'food_drop_retailer',
  {
    foodDropId: uuid('food_drop_id')
      .notNull()
      .references(() => foodDrop.id, { onDelete: 'cascade' }),
    retailerId: smallint('retailer_id')
      .notNull()
      .references(() => retailer.id),
    countryCode: char('country_code', { length: 2 }).references(() => country.code),
    confidence: real('confidence').notNull().default(0.5),
    evidenceRawItemId: uuid('evidence_raw_item_id').references(() => rawItem.id),
  },
  (table) => [primaryKey({ columns: [table.foodDropId, table.retailerId] })],
);

export const foodDropMerge = pgTable('food_drop_merge', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  winnerFoodDropId: uuid('winner_food_drop_id')
    .notNull()
    .references(() => foodDrop.id),
  mergedFoodDropId: uuid('merged_food_drop_id')
    .notNull()
    .references(() => foodDrop.id),
  method: linkMethodEnum('method').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
