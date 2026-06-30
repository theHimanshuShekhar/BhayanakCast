CREATE TYPE "public"."room_state" AS ENUM('live', 'empty_grace', 'ended');--> statement-breakpoint
CREATE TYPE "public"."room_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp (3) with time zone,
	"refresh_token_expires_at" timestamp (3) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_body_len_chk" CHECK (char_length("chat_messages"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "room_bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"banned_user_id" text NOT NULL,
	"banned_by_user_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp (3) with time zone,
	"cleared_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "room_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp (3) with time zone,
	"reconnect_grace_ends_at" timestamp (3) with time zone,
	CONSTRAINT "room_memberships_interval_chk" CHECK ("room_memberships"."left_at" is null or "room_memberships"."left_at" >= "room_memberships"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"visibility" "room_visibility" DEFAULT 'public' NOT NULL,
	"password_hash" text,
	"state" "room_state" DEFAULT 'live' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"current_host_user_id" text NOT NULL,
	"empty_since" timestamp (3) with time zone,
	"ended_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_name_len_chk" CHECK (char_length("rooms"."name") between 3 and 80),
	CONSTRAINT "rooms_tags_count_chk" CHECK (array_length("rooms"."tags", 1) is null or array_length("rooms"."tags", 1) <= 5),
	CONSTRAINT "rooms_private_password_chk" CHECK ("rooms"."visibility" <> 'private' or "rooms"."password_hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_banned_user_id_user_id_fk" FOREIGN KEY ("banned_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_banned_by_user_id_user_id_fk" FOREIGN KEY ("banned_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bans" ADD CONSTRAINT "room_bans_cleared_by_user_id_user_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_current_host_user_id_user_id_fk" FOREIGN KEY ("current_host_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_room_created_idx" ON "chat_messages" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "room_bans_room_idx" ON "room_bans" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_bans_one_effective_idx" ON "room_bans" USING btree ("room_id","banned_user_id") WHERE "room_bans"."cleared_at" is null;--> statement-breakpoint
CREATE INDEX "room_memberships_room_active_idx" ON "room_memberships" USING btree ("room_id","left_at");--> statement-breakpoint
CREATE INDEX "room_memberships_user_joined_idx" ON "room_memberships" USING btree ("user_id","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "room_memberships_one_active_user_per_room_idx" ON "room_memberships" USING btree ("room_id","user_id") WHERE "room_memberships"."left_at" is null;--> statement-breakpoint
CREATE INDEX "rooms_discovery_idx" ON "rooms" USING btree ("state","visibility","updated_at");--> statement-breakpoint
CREATE INDEX "rooms_created_by_idx" ON "rooms" USING btree ("created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");