CREATE TYPE "public"."drop_status" AS ENUM('new', 'coming_soon', 'limited_time', 'returning', 'discontinued', 'rumored');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('success', 'partial', 'error', 'skipped_not_modified');--> statement-breakpoint
CREATE TYPE "public"."item_stage" AS ENUM('discovered', 'candidate', 'rejected', 'extracted', 'linked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."link_method" AS ENUM('exact_url', 'content_hash', 'name_brand', 'fuzzy', 'llm', 'manual');--> statement-breakpoint
CREATE TYPE "public"."retailer_type" AS ENUM('grocery', 'convenience', 'pharmacy', 'mass', 'restaurant', 'online');--> statement-breakpoint
CREATE TYPE "public"."source_role" AS ENUM('primary', 'corroborating');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('rss', 'json_api', 'html_listing', 'reddit', 'youtube');--> statement-breakpoint
CREATE TABLE "category" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "country" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"region" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retailer" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "retailer_type" NOT NULL,
	"country_code" char(2),
	"logo_url" text,
	CONSTRAINT "retailer_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "fetch_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "fetch_status" NOT NULL,
	"http_status" integer,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"error_kind" text,
	"error_message" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "raw_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"fetch_run_id" bigint,
	"url" text NOT NULL,
	"url_hash" "bytea" NOT NULL,
	"content_hash" "bytea",
	"title" text,
	"author" text,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"excerpt" text,
	"body_text" text,
	"image_url" text,
	"raw_payload" jsonb,
	"stage" "item_stage" DEFAULT 'discovered' NOT NULL,
	"filter_reason" text,
	"relevance_score" real,
	"processed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "raw_item_source_url_uniq" UNIQUE("source_id","url_hash")
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "source_type" NOT NULL,
	"url" text NOT NULL,
	"homepage_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"fetch_interval_minutes" integer DEFAULT 60 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trust_tier" integer DEFAULT 2 NOT NULL,
	"default_country" char(2),
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"http_etag" text,
	"http_last_modified" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_slug_unique" UNIQUE("slug"),
	CONSTRAINT "source_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"parent_brand_id" uuid,
	"country_code" char(2),
	"website_url" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "brand_alias" (
	"brand_id" uuid NOT NULL,
	"normalized_alias" text NOT NULL,
	CONSTRAINT "brand_alias_brand_id_normalized_alias_pk" PRIMARY KEY("brand_id","normalized_alias")
);
--> statement-breakpoint
CREATE TABLE "food_drop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"brand_id" uuid,
	"category_id" smallint NOT NULL,
	"subcategory" text,
	"short_description" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "drop_status" NOT NULL,
	"is_limited_time" boolean DEFAULT false NOT NULL,
	"release_date" date,
	"availability_start" date,
	"availability_end" date,
	"price_cents" integer,
	"price_currency" char(3),
	"image_url" text,
	"image_stored_key" text,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"source_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_source_at" timestamp with time zone,
	"trending_score" real DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_drop_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "food_drop_country" (
	"food_drop_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "food_drop_country_food_drop_id_country_code_pk" PRIMARY KEY("food_drop_id","country_code")
);
--> statement-breakpoint
CREATE TABLE "food_drop_merge" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"winner_food_drop_id" uuid NOT NULL,
	"merged_food_drop_id" uuid NOT NULL,
	"method" "link_method" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_drop_retailer" (
	"food_drop_id" uuid NOT NULL,
	"retailer_id" smallint NOT NULL,
	"country_code" char(2),
	"confidence" real DEFAULT 0.5 NOT NULL,
	"evidence_raw_item_id" uuid,
	CONSTRAINT "food_drop_retailer_food_drop_id_retailer_id_pk" PRIMARY KEY("food_drop_id","retailer_id")
);
--> statement-breakpoint
CREATE TABLE "food_drop_source" (
	"food_drop_id" uuid NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"role" "source_role" DEFAULT 'corroborating' NOT NULL,
	"link_method" "link_method" NOT NULL,
	"link_confidence" real NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_drop_source_food_drop_id_raw_item_id_pk" PRIMARY KEY("food_drop_id","raw_item_id")
);
--> statement-breakpoint
ALTER TABLE "retailer" ADD CONSTRAINT "retailer_country_code_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."country"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_run" ADD CONSTRAINT "fetch_run_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_item" ADD CONSTRAINT "raw_item_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_item" ADD CONSTRAINT "raw_item_fetch_run_id_fetch_run_id_fk" FOREIGN KEY ("fetch_run_id") REFERENCES "public"."fetch_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_parent_brand_id_brand_id_fk" FOREIGN KEY ("parent_brand_id") REFERENCES "public"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_alias" ADD CONSTRAINT "brand_alias_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop" ADD CONSTRAINT "food_drop_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop" ADD CONSTRAINT "food_drop_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop" ADD CONSTRAINT "food_drop_merged_into_id_food_drop_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."food_drop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_country" ADD CONSTRAINT "food_drop_country_food_drop_id_food_drop_id_fk" FOREIGN KEY ("food_drop_id") REFERENCES "public"."food_drop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_country" ADD CONSTRAINT "food_drop_country_country_code_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."country"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_merge" ADD CONSTRAINT "food_drop_merge_winner_food_drop_id_food_drop_id_fk" FOREIGN KEY ("winner_food_drop_id") REFERENCES "public"."food_drop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_merge" ADD CONSTRAINT "food_drop_merge_merged_food_drop_id_food_drop_id_fk" FOREIGN KEY ("merged_food_drop_id") REFERENCES "public"."food_drop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_retailer" ADD CONSTRAINT "food_drop_retailer_food_drop_id_food_drop_id_fk" FOREIGN KEY ("food_drop_id") REFERENCES "public"."food_drop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_retailer" ADD CONSTRAINT "food_drop_retailer_retailer_id_retailer_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_retailer" ADD CONSTRAINT "food_drop_retailer_country_code_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."country"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_retailer" ADD CONSTRAINT "food_drop_retailer_evidence_raw_item_id_raw_item_id_fk" FOREIGN KEY ("evidence_raw_item_id") REFERENCES "public"."raw_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_source" ADD CONSTRAINT "food_drop_source_food_drop_id_food_drop_id_fk" FOREIGN KEY ("food_drop_id") REFERENCES "public"."food_drop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_source" ADD CONSTRAINT "food_drop_source_raw_item_id_raw_item_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_drop_source" ADD CONSTRAINT "food_drop_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetch_run_source_time_idx" ON "fetch_run" USING btree ("source_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "raw_item_url_hash_idx" ON "raw_item" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "raw_item_content_hash_idx" ON "raw_item" USING btree ("content_hash") WHERE "raw_item"."content_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "raw_item_queue_idx" ON "raw_item" USING btree ("stage","discovered_at") WHERE "raw_item"."stage" IN ('discovered', 'candidate');--> statement-breakpoint
CREATE INDEX "brand_normalized_trgm_idx" ON "brand" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "brand_alias_uniq" ON "brand_alias" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "food_drop_feed_idx" ON "food_drop" USING btree ("first_seen_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "food_drop"."published" AND "food_drop"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "food_drop_trending_idx" ON "food_drop" USING btree ("trending_score" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "food_drop"."published" AND "food_drop"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "food_drop_category_idx" ON "food_drop" USING btree ("category_id","first_seen_at" DESC NULLS LAST) WHERE "food_drop"."published" AND "food_drop"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "food_drop_brand_idx" ON "food_drop" USING btree ("brand_id","first_seen_at" DESC NULLS LAST) WHERE "food_drop"."published" AND "food_drop"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "food_drop_status_idx" ON "food_drop" USING btree ("status","first_seen_at" DESC NULLS LAST) WHERE "food_drop"."published" AND "food_drop"."merged_into_id" IS NULL;--> statement-breakpoint
CREATE INDEX "food_drop_search_idx" ON "food_drop" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "food_drop_name_trgm_idx" ON "food_drop" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "food_drop_country_lookup_idx" ON "food_drop_country" USING btree ("country_code","food_drop_id");--> statement-breakpoint
CREATE INDEX "food_drop_source_raw_idx" ON "food_drop_source" USING btree ("raw_item_id");