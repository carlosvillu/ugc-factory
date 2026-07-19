DROP INDEX "generation_production_content_hash_key";--> statement-breakpoint
ALTER TABLE "prompt_template" ADD COLUMN "thumbnail_asset_id" text;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "template_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_template_test_content_hash_key" ON "generation" USING btree ("content_hash") WHERE "generation"."template_test" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_production_content_hash_key" ON "generation" USING btree ("content_hash") WHERE "generation"."voice_preview" = false and "generation"."template_test" = false and "generation"."status" not in ('failed', 'cancelled');