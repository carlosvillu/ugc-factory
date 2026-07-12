CREATE TABLE "checkpoint_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"step_run_id" text NOT NULL,
	"kind" text NOT NULL,
	"decision" jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoint_decision_step_run_id_key" UNIQUE("step_run_id")
);
--> statement-breakpoint
ALTER TABLE "checkpoint_decision" ADD CONSTRAINT "checkpoint_decision_step_run_id_step_run_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."step_run"("id") ON DELETE cascade ON UPDATE no action;