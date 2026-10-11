CREATE TYPE "public"."quality_direction" AS ENUM('send', 'recv');--> statement-breakpoint
CREATE TYPE "public"."quality_slot" AS ENUM('screen', 'cam');--> statement-breakpoint
CREATE TYPE "public"."quality_trigger" AS ENUM('window', 'rung');--> statement-breakpoint
CREATE TYPE "public"."quality_rung_reason" AS ENUM('pressure', 'probe', 'capture', 'budget', 'resume');--> statement-breakpoint
CREATE TABLE "quality_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" text NOT NULL,
	"room_kind" "room_kind" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"window_ms" integer NOT NULL,
	"reporter_user_id" text NOT NULL,
	"peer_user_id" text NOT NULL,
	"direction" "quality_direction" NOT NULL,
	"slot" "quality_slot" NOT NULL,
	"trigger" "quality_trigger" NOT NULL,
	"browser" text NOT NULL,
	"browser_major" integer,
	"rung" text,
	"max_bitrate" integer,
	"to_rung" text,
	"rung_reason" "quality_rung_reason",
	"target_bitrate" integer,
	"bitrate" integer,
	"available_bitrate" integer,
	"qp" real,
	"codec" text,
	"frame_width" integer,
	"frame_height" integer,
	"fps" real,
	"limitation" text,
	"loss" real,
	"rtt_ms" real,
	"plis" integer,
	"firs" integer,
	"nacks" integer,
	"key_frames" integer,
	"freezes" integer,
	"freeze_seconds" real,
	"local_candidate" text,
	"remote_candidate" text,
	"relay_protocol" text
);
--> statement-breakpoint
CREATE INDEX "quality_samples_room_idx" ON "quality_samples" USING btree ("room_id","at");--> statement-breakpoint
CREATE INDEX "quality_samples_at_idx" ON "quality_samples" USING btree ("at");