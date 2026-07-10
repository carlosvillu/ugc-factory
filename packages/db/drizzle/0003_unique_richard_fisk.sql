CREATE TYPE "public"."asset_kind" AS ENUM('product_image', 'reference_image', 'keyframe', 'tts_audio', 'avatar_clip', 'broll_clip', 'music_bed', 'final_video', 'thumbnail', 'screenshot', 'font', 'other');--> statement-breakpoint
CREATE TABLE "asset" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
