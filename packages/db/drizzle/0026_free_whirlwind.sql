CREATE TYPE "public"."publish_flow_state" AS ENUM('ready', 'waiting_confirmation', 'confirmed');--> statement-breakpoint
CREATE TABLE "variant_publishing" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"checklist_marks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cp5_enabled" boolean DEFAULT false NOT NULL,
	"flow_state" "publish_flow_state" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_publishing_variant_id_unique" UNIQUE("variant_id")
);
--> statement-breakpoint
ALTER TABLE "variant_publishing" ADD CONSTRAINT "variant_publishing_variant_id_ad_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."ad_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "variant_publishing_variant_id_idx" ON "variant_publishing" USING btree ("variant_id");