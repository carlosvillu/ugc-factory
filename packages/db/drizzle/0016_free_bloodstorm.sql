CREATE TYPE "public"."generation_status" AS ENUM('submitting', 'submitted', 'in_queue', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "generation" (
	"id" text PRIMARY KEY NOT NULL,
	"step_run_id" text,
	"variant_id" text,
	"model_profile_id" text NOT NULL,
	"prompt_template_id" text,
	"template_version" integer,
	"fal_request_id" text,
	"status_url" text,
	"response_url" text,
	"resolved_prompt" text,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"status" "generation_status" DEFAULT 'submitting' NOT NULL,
	"fal_status_payload" jsonb,
	"qa" jsonb,
	"score" real,
	"cost_actual" integer,
	"duration_s" real,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "fal_url" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "fal_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "duration_s" real;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "generation_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_fal_request_id_key" ON "generation" USING btree ("fal_request_id");