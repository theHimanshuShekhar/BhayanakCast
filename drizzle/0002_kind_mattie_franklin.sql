CREATE TYPE "public"."admin_action_kind" AS ENUM('ban', 'unban');--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" "admin_action_kind" NOT NULL,
	"target_user_id" text,
	"target_room_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_actions_at_idx" ON "admin_actions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "admin_actions_target_user_idx" ON "admin_actions" USING btree ("target_user_id");