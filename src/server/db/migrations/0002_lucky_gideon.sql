CREATE TABLE "account_state" (
	"account_id" text PRIMARY KEY NOT NULL,
	"deletion_requested_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "platform_sanction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"type" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"lifted_at" timestamp,
	CONSTRAINT "platform_sanction_type_check" CHECK ("platform_sanction"."type" in ('streaming', 'chat', 'room_creation', 'all_access')),
	CONSTRAINT "platform_sanction_expiry_check" CHECK ("platform_sanction"."expires_at" is null or "platform_sanction"."expires_at" > "platform_sanction"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "room_ban" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"cleared_at" timestamp,
	CONSTRAINT "room_ban_interval_check" CHECK ("room_ban"."cleared_at" is null or "room_ban"."cleared_at" >= "room_ban"."created_at")
);
--> statement-breakpoint
CREATE TABLE "room_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp NOT NULL,
	"left_at" timestamp,
	CONSTRAINT "room_membership_role_check" CHECK ("room_membership"."role" in ('host', 'member')),
	CONSTRAINT "room_membership_interval_check" CHECK ("room_membership"."left_at" is null or "room_membership"."left_at" >= "room_membership"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"visibility" text NOT NULL,
	"password_hash" text,
	"created_by" text,
	"created_at" timestamp NOT NULL,
	"empty_at" timestamp,
	"ended_at" timestamp,
	CONSTRAINT "room_visibility_check" CHECK ("room"."visibility" in ('public', 'private')),
	CONSTRAINT "room_password_check" CHECK (("room"."visibility" = 'public' and "room"."password_hash" is null) or ("room"."visibility" = 'private' and "room"."password_hash" is not null)),
	CONSTRAINT "room_end_check" CHECK ("room"."ended_at" is null or "room"."ended_at" >= "room"."created_at")
);
--> statement-breakpoint
CREATE TABLE "stream" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"preview_key" text,
	"preview_updated_at" timestamp,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	CONSTRAINT "stream_interval_check" CHECK ("stream"."ended_at" is null or "stream"."ended_at" >= "stream"."started_at"),
	CONSTRAINT "stream_preview_check" CHECK (("stream"."preview_key" is null and "stream"."preview_updated_at" is null) or ("stream"."preview_key" is not null and "stream"."preview_updated_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "stream_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewer_membership_id" uuid NOT NULL,
	"stream_id" uuid NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	CONSTRAINT "stream_subscription_interval_check" CHECK ("stream_subscription"."ended_at" is null or "stream_subscription"."ended_at" >= "stream_subscription"."started_at")
);
--> statement-breakpoint
ALTER TABLE "account_state" ADD CONSTRAINT "account_state_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ban" ADD CONSTRAINT "room_ban_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ban" ADD CONSTRAINT "room_ban_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ban" ADD CONSTRAINT "room_ban_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream" ADD CONSTRAINT "stream_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream" ADD CONSTRAINT "stream_membership_id_room_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "room_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_subscription" ADD CONSTRAINT "stream_subscription_viewer_membership_id_room_membership_id_fk" FOREIGN KEY ("viewer_membership_id") REFERENCES "room_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_subscription" ADD CONSTRAINT "stream_subscription_stream_id_stream_id_fk" FOREIGN KEY ("stream_id") REFERENCES "stream"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_ban_one_active_idx" ON "room_ban" USING btree ("room_id","account_id") WHERE "room_ban"."cleared_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "room_membership_one_current_account_idx" ON "room_membership" USING btree ("account_id") WHERE "room_membership"."left_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "room_membership_one_current_host_idx" ON "room_membership" USING btree ("room_id") WHERE "room_membership"."left_at" is null and "room_membership"."role" = 'host';--> statement-breakpoint
CREATE INDEX "room_membership_current_room_idx" ON "room_membership" USING btree ("room_id","left_at");--> statement-breakpoint
CREATE INDEX "room_active_activity_idx" ON "room" USING btree ("ended_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_one_active_membership_idx" ON "stream" USING btree ("membership_id") WHERE "stream"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stream_subscription_one_active_viewer_idx" ON "stream_subscription" USING btree ("viewer_membership_id") WHERE "stream_subscription"."ended_at" is null;