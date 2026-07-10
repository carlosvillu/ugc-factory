CREATE TYPE "public"."brand_kit_source" AS ENUM('extracted', 'manual');--> statement-breakpoint
CREATE TYPE "public"."product_brief_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."url_analysis_platform" AS ENUM('shopify', 'woocommerce', 'custom', 'amazon', 'manual');--> statement-breakpoint
CREATE TYPE "public"."url_analysis_source" AS ENUM('url', 'manual');--> statement-breakpoint
CREATE TYPE "public"."url_analysis_status" AS ENUM('pending', 'scraping', 'analyzing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "brand_kit" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"domain" text,
	"source" "brand_kit_source" NOT NULL,
	"logo_asset_id" text,
	"palette" jsonb NOT NULL,
	"typography" text,
	"tone_of_voice" text NOT NULL,
	"aesthetic" text NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_brief" (
	"id" text PRIMARY KEY NOT NULL,
	"url_analysis_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"language" text NOT NULL,
	"status" "product_brief_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "url_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" "url_analysis_source" NOT NULL,
	"url_normalized" text,
	"content_hash" text,
	"platform" "url_analysis_platform" NOT NULL,
	"raw_content" jsonb NOT NULL,
	"status" "url_analysis_status" DEFAULT 'pending' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_logo_asset_id_asset_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_brief" ADD CONSTRAINT "product_brief_url_analysis_id_url_analysis_id_fk" FOREIGN KEY ("url_analysis_id") REFERENCES "public"."url_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_analysis" ADD CONSTRAINT "url_analysis_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kit_domain_key" ON "brand_kit" USING btree ("domain") WHERE "brand_kit"."domain" IS NOT NULL;