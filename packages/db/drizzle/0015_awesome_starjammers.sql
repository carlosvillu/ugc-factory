CREATE TYPE "public"."guard_scope" AS ENUM('general', 'vertical', 'fidelity', 'platform');--> statement-breakpoint
CREATE TYPE "public"."model_kind" AS ENUM('t2v', 'i2v', 'r2v', 'avatar', 'lipsync', 'tts', 'image', 'music', 'utility');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."prompt_kind" AS ENUM('video', 'image', 'script', 'voiceover');--> statement-breakpoint
CREATE TYPE "public"."prompt_status" AS ENUM('draft', 'review', 'published', 'deprecated');--> statement-breakpoint
CREATE TABLE "guard_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"scope" "guard_scope" NOT NULL,
	"vertical" text,
	"platform" text,
	"lines" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"fal_endpoint" text NOT NULL,
	"kind" "model_kind" NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_adapter" text,
	"status" "model_status" DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_template" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"kind" "prompt_kind" NOT NULL,
	"body" text NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asset_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guard_pack_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_duration_s" integer,
	"default_aspect" text,
	"formats" text[] DEFAULT '{}'::text[] NOT NULL,
	"hook_angles" text[] DEFAULT '{}'::text[] NOT NULL,
	"verticals" text[] DEFAULT '{}'::text[] NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"aesthetics" text[] DEFAULT '{}'::text[] NOT NULL,
	"free_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "prompt_status" DEFAULT 'draft' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"license" text,
	"author" text,
	"attribution" text,
	"language" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compliance" jsonb,
	"perf" jsonb,
	"head_version" integer DEFAULT 0 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_version" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guard_pack_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"changelog" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_template_id_prompt_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guard_pack_key_key" ON "guard_pack" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "model_profile_fal_endpoint_key" ON "model_profile" USING btree ("fal_endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_template_slug_key" ON "prompt_template" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "prompt_template_formats_gin" ON "prompt_template" USING gin ("formats" array_ops);--> statement-breakpoint
CREATE INDEX "prompt_template_hook_angles_gin" ON "prompt_template" USING gin ("hook_angles" array_ops);--> statement-breakpoint
CREATE INDEX "prompt_template_verticals_gin" ON "prompt_template" USING gin ("verticals" array_ops);--> statement-breakpoint
CREATE INDEX "prompt_template_platforms_gin" ON "prompt_template" USING gin ("platforms" array_ops);--> statement-breakpoint
CREATE INDEX "prompt_template_aesthetics_gin" ON "prompt_template" USING gin ("aesthetics" array_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_template_version_key" ON "prompt_version" USING btree ("template_id","version");