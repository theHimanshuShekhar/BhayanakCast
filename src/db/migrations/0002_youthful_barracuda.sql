CREATE TYPE "public"."stream_stop_reason" AS ENUM('self', 'host', 'disconnect', 'socket_replaced', 'room_ended');--> statement-breakpoint
CREATE TABLE "stream_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"stop_reason" "stream_stop_reason",
	"has_video" boolean NOT NULL,
	"has_audio" boolean NOT NULL,
	"display_surface" text,
	"label" text,
	"thumbnail_updated_at" timestamp (3) with time zone,
	CONSTRAINT "stream_sessions_track_chk" CHECK ("stream_sessions"."has_video" = true)
);
--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stream_sessions_room_active_idx" ON "stream_sessions" USING btree ("room_id","ended_at");--> statement-breakpoint
CREATE INDEX "stream_sessions_user_started_idx" ON "stream_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_sessions_one_active_user_per_room_idx" ON "stream_sessions" USING btree ("room_id","user_id") WHERE "stream_sessions"."ended_at" is null;