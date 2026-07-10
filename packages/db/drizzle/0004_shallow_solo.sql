CREATE TYPE "public"."budget_scope" AS ENUM('monthly', 'batch');--> statement-breakpoint
CREATE TYPE "public"."cost_provider" AS ENUM('fal', 'anthropic', 'firecrawl', 'other');--> statement-breakpoint
CREATE TABLE "budget" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "budget_scope" NOT NULL,
	"limit_cents" integer NOT NULL,
	"alert_thresholds" integer[] DEFAULT '{}'::integer[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "cost_provider" NOT NULL,
	"step_run_id" text,
	"generation_id" text,
	"project_id" text,
	"amount_cents" integer NOT NULL,
	"quantity" integer,
	"unit" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cost_entry_occurred_at_idx" ON "cost_entry" USING btree ("occurred_at");