CREATE TYPE "public"."run_kind" AS ENUM('full', 'partial', 'regen');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('awaiting_deps', 'pending', 'queued', 'submitting', 'running', 'waiting_approval', 'succeeded', 'failed', 'rejected', 'skipped', 'cancelled', 'expired', 'superseded');--> statement-breakpoint
CREATE TABLE "pipeline_run" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"batch_id" text,
	"kind" "run_kind" DEFAULT 'full' NOT NULL,
	"autopilot" boolean DEFAULT false NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total_cost_estimated" integer,
	"total_cost_actual" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_run" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_key" text NOT NULL,
	"variant_id" text,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"supersedes_id" text,
	"is_checkpoint" boolean DEFAULT false NOT NULL,
	"checkpoint_config" jsonb,
	"depends_on" text[] DEFAULT '{}'::text[] NOT NULL,
	"input_refs" jsonb,
	"output_refs" jsonb,
	"error" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"timeout_at" timestamp with time zone,
	"cost_estimated" integer,
	"cost_actual" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_supersedes_id_step_run_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."step_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "step_run_run_id_idx" ON "step_run" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "step_run_sweep_idx" ON "step_run" USING btree ("timeout_at") WHERE "step_run"."timeout_at" IS NOT NULL;