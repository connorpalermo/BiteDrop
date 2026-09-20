import { char, integer, pgTable, smallserial, text } from 'drizzle-orm/pg-core';
import { retailerTypeEnum } from './enums';

export const category = pgTable('category', {
  id: smallserial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const country = pgTable('country', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  region: text('region').notNull(),
});

export const retailer = pgTable('retailer', {
  id: smallserial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  type: retailerTypeEnum('type').notNull(),
  countryCode: char('country_code', { length: 2 }).references(() => country.code),
  logoUrl: text('logo_url'),
});
