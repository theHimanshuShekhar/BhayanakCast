CREATE TYPE "public"."room_kind" AS ENUM('gaming', 'code', 'music', 'art', 'watch', 'chat');--> statement-breakpoint
CREATE TYPE "public"."room_role" AS ENUM('host', 'mod', 'member');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"discord_id" text,
	"discord_username" text,
	"settings" jsonb DEFAULT '{"theme":"dark","accentHue":265,"radius":12,"density":"comfortable","layout":"mosaic","showChat":true}'::jsonb NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" text NOT NULL,
	"favorite_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_favorite_user_id_pk" PRIMARY KEY("user_id","favorite_user_id"),
	CONSTRAINT "favorites_not_self" CHECK ("favorites"."user_id" <> "favorites"."favorite_user_id")
);
--> statement-breakpoint
CREATE TABLE "presence_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "presence_intervals_order" CHECK ("presence_intervals"."ended_at" is null or "presence_intervals"."ended_at" >= "presence_intervals"."started_at")
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "room_role" DEFAULT 'member' NOT NULL,
	"kicked" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" "room_kind" DEFAULT 'chat' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"invite_token" text,
	"created_by" text,
	"host_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_empty_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"peak_participants" integer DEFAULT 0 NOT NULL,
	"last_thumbnail_at" timestamp with time zone,
	"stats_rolled_up_at" timestamp with time zone,
	CONSTRAINT "rooms_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "stream_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stream_intervals_order" CHECK ("stream_intervals"."ended_at" is null or "stream_intervals"."ended_at" >= "stream_intervals"."started_at")
);
--> statement-breakpoint
CREATE TABLE "thumbnails" (
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"image" "bytea" NOT NULL,
	"mime" text DEFAULT 'image/webp' NOT NULL,
	CONSTRAINT "thumbnails_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_platform_stats" (
	"day" date PRIMARY KEY NOT NULL,
	"new_users" integer DEFAULT 0 NOT NULL,
	"rooms_created" integer DEFAULT 0 NOT NULL,
	"rooms_ended" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_cotime" (
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"seconds_together" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_cotime_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "user_cotime_ordered" CHECK ("user_cotime"."user_a" < "user_cotime"."user_b")
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"seconds_streamed" bigint DEFAULT 0 NOT NULL,
	"seconds_watched" bigint DEFAULT 0 NOT NULL,
	"rooms_hosted" integer DEFAULT 0 NOT NULL,
	"rooms_joined" integer DEFAULT 0 NOT NULL,
	"peak_viewers" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_favorite_user_id_user_id_fk" FOREIGN KEY ("favorite_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_intervals" ADD CONSTRAINT "presence_intervals_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_intervals" ADD CONSTRAINT "presence_intervals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_intervals" ADD CONSTRAINT "stream_intervals_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_intervals" ADD CONSTRAINT "stream_intervals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thumbnails" ADD CONSTRAINT "thumbnails_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cotime" ADD CONSTRAINT "user_cotime_user_a_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cotime" ADD CONSTRAINT "user_cotime_user_b_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_discord_username_idx" ON "user" USING btree ("discord_username");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "favorites_favorite_user_id_idx" ON "favorites" USING btree ("favorite_user_id");--> statement-breakpoint
CREATE INDEX "presence_intervals_room_idx" ON "presence_intervals" USING btree ("room_id","started_at");--> statement-breakpoint
CREATE INDEX "presence_intervals_user_idx" ON "presence_intervals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "presence_intervals_one_open_idx" ON "presence_intervals" USING btree ("room_id","user_id") WHERE "presence_intervals"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "room_members_user_id_idx" ON "room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rooms_live_idx" ON "rooms" USING btree ("created_at") WHERE "rooms"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "rooms_ended_at_idx" ON "rooms" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "rooms_created_by_idx" ON "rooms" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "stream_intervals_room_idx" ON "stream_intervals" USING btree ("room_id","started_at");--> statement-breakpoint
CREATE INDEX "stream_intervals_user_idx" ON "stream_intervals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_intervals_one_open_idx" ON "stream_intervals" USING btree ("room_id","user_id") WHERE "stream_intervals"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "user_cotime_user_b_idx" ON "user_cotime" USING btree ("user_b");