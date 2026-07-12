CREATE TYPE "public"."persona_gender" AS ENUM('female', 'male', 'non_binary');--> statement-breakpoint
CREATE TABLE "persona" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"age_range" text NOT NULL,
	"gender" "persona_gender" NOT NULL,
	"ethnicity" text NOT NULL,
	"style" text NOT NULL,
	"descriptor" text NOT NULL,
	"setting" text NOT NULL,
	"personality" text NOT NULL,
	"wardrobe_notes" text,
	"voice_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reference_image_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"perf" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "persona_name_key" ON "persona" USING btree ("name");--> statement-breakpoint
ALTER TABLE "ad_variant" ADD CONSTRAINT "ad_variant_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE set null ON UPDATE no action;