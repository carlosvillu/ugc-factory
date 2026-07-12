CREATE TYPE "public"."ad_batch_status" AS ENUM('planned', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ad_variant_status" AS ENUM('planned', 'scripting', 'scripted', 'generating', 'composing', 'qa', 'approved', 'rejected', 'published');--> statement-breakpoint
CREATE TYPE "public"."ad_objective" AS ENUM('hook_test', 'conversion', 'story');--> statement-breakpoint
CREATE TYPE "public"."recipe_tier" AS ENUM('test', 'standard', 'premium');--> statement-breakpoint
CREATE TABLE "ad_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"brief_id" text NOT NULL,
	"matrix" jsonb NOT NULL,
	"tier" "recipe_tier" NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"objective" "ad_objective" NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "ad_batch_status" DEFAULT 'planned' NOT NULL,
	"cost_estimated_cents" integer,
	"cost_actual_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_script" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hook" text NOT NULL,
	"scenes" jsonb NOT NULL,
	"subtitles" jsonb NOT NULL,
	"cta" text NOT NULL,
	"full_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"est_seconds" integer NOT NULL,
	"tone" text NOT NULL,
	"language" text NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"guardrail_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"angle_name" text NOT NULL,
	"framework" text NOT NULL,
	"hook_line_id" text,
	"persona_id" text,
	"language" text NOT NULL,
	"prompt_template_id" text,
	"template_version" integer,
	"duration_target" integer NOT NULL,
	"platform_targets" text[] DEFAULT '{}'::text[] NOT NULL,
	"composition_spec" jsonb,
	"filename_code" text NOT NULL,
	"status" "ad_variant_status" DEFAULT 'planned' NOT NULL,
	"master_asset_id" text,
	"thumbnail_asset_id" text,
	"qa_report" jsonb,
	"score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_variant_filename_code_unique" UNIQUE("filename_code")
);
--> statement-breakpoint
CREATE TABLE "cta_line" (
	"id" text PRIMARY KEY NOT NULL,
	"objective" "ad_objective" NOT NULL,
	"text" text NOT NULL,
	"language" text NOT NULL,
	"perf" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hook_line" (
	"id" text PRIMARY KEY NOT NULL,
	"angle" text NOT NULL,
	"text" text NOT NULL,
	"verticals" text[] DEFAULT '{}'::text[] NOT NULL,
	"language" text NOT NULL,
	"perf" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" "recipe_tier" PRIMARY KEY NOT NULL,
	"steps" jsonb NOT NULL,
	"est_cost_30s_min_cents" integer NOT NULL,
	"est_cost_30s_max_cents" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_batch" ADD CONSTRAINT "ad_batch_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_batch" ADD CONSTRAINT "ad_batch_brief_id_product_brief_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."product_brief"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_script" ADD CONSTRAINT "ad_script_variant_id_ad_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."ad_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_variant" ADD CONSTRAINT "ad_variant_batch_id_ad_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ad_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_variant" ADD CONSTRAINT "ad_variant_hook_line_id_hook_line_id_fk" FOREIGN KEY ("hook_line_id") REFERENCES "public"."hook_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_variant" ADD CONSTRAINT "ad_variant_master_asset_id_asset_id_fk" FOREIGN KEY ("master_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_variant" ADD CONSTRAINT "ad_variant_thumbnail_asset_id_asset_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_batch_project_id_idx" ON "ad_batch" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_script_variant_version_key" ON "ad_script" USING btree ("variant_id","version");--> statement-breakpoint
CREATE INDEX "ad_variant_batch_id_idx" ON "ad_variant" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cta_line_language_text_key" ON "cta_line" USING btree ("language","text");--> statement-breakpoint
CREATE INDEX "cta_line_objective_language_idx" ON "cta_line" USING btree ("objective","language");--> statement-breakpoint
CREATE UNIQUE INDEX "hook_line_language_text_key" ON "hook_line" USING btree ("language","text");--> statement-breakpoint
CREATE INDEX "hook_line_angle_language_idx" ON "hook_line" USING btree ("angle","language");