ALTER TABLE "asset" ADD COLUMN "normalized_cache_key" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "parent_asset_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "asset_normalized_cache_key_idx" ON "asset" USING btree ("normalized_cache_key") WHERE "asset"."normalized_cache_key" is not null;