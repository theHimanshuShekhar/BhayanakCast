CREATE TYPE "public"."report_resolution" AS ENUM('resolved', 'dismissed');--> statement-breakpoint
ALTER TABLE "platform_sanctions" ADD COLUMN "lifted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "thumbnail_content_type" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution" "report_resolution";--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "platform_sanctions" ADD CONSTRAINT "platform_sanctions_lifted_by_user_id_user_id_fk" FOREIGN KEY ("lifted_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_resolved_idx" ON "reports" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "reports_room_idx" ON "reports" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_bans_banned_user_idx" ON "room_bans" USING btree ("banned_user_id");--> statement-breakpoint
CREATE INDEX "rooms_current_host_idx" ON "rooms" USING btree ("current_host_user_id");--> statement-breakpoint
ALTER TABLE "platform_sanctions" ADD CONSTRAINT "platform_sanctions_expiry_chk" CHECK ("platform_sanctions"."expires_at" is null or "platform_sanctions"."expires_at" > "platform_sanctions"."starts_at");--> statement-breakpoint
ALTER TABLE "platform_sanctions" ADD CONSTRAINT "platform_sanctions_lift_consistency_chk" CHECK (("platform_sanctions"."lifted_at" is null and "platform_sanctions"."lifted_by_user_id" is null) or ("platform_sanctions"."lifted_at" is not null and "platform_sanctions"."lifted_by_user_id" is not null));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_details_len_chk" CHECK ("reports"."details" is null or char_length("reports"."details") <= 4000);--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolution_consistency_chk" CHECK (("reports"."resolved_at" is null and "reports"."resolved_by_user_id" is null and "reports"."resolution" is null) or ("reports"."resolved_at" is not null and "reports"."resolved_by_user_id" is not null and "reports"."resolution" is not null));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_thumbnail_content_type_chk" CHECK ("reports"."thumbnail_content_type" is null or "reports"."thumbnail_content_type" in ('image/webp', 'image/jpeg'));--> statement-breakpoint
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_clear_consistency_chk" CHECK (("room_bans"."cleared_at" is null and "room_bans"."cleared_by_user_id" is null) or ("room_bans"."cleared_at" is not null and "room_bans"."cleared_by_user_id" is not null));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_category_len_chk" CHECK (char_length("rooms"."category") between 1 and 80);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_empty_since_chk" CHECK ("rooms"."state" <> 'empty_grace' or "rooms"."empty_since" is not null);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ended_at_chk" CHECK ("rooms"."state" <> 'ended' or "rooms"."ended_at" is not null);--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_interval_chk" CHECK ("stream_sessions"."ended_at" is null or "stream_sessions"."ended_at" >= "stream_sessions"."started_at");--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_stop_reason_chk" CHECK (("stream_sessions"."ended_at" is null and "stream_sessions"."stop_reason" is null) or ("stream_sessions"."ended_at" is not null and "stream_sessions"."stop_reason" is not null));