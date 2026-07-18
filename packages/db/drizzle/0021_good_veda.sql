CREATE TYPE "public"."audio_source" AS ENUM('ai_bed', 'own_license', 'native_trending');--> statement-breakpoint
ALTER TABLE "ad_variant" ADD COLUMN "audio_source" "audio_source";