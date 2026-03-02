CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"total_time_seconds" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "streaming_rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"streamer_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_relationships" (
	"user1_id" text NOT NULL,
	"user2_id" text NOT NULL,
	"total_time_seconds" integer DEFAULT 0 NOT NULL,
	"rooms_count" integer DEFAULT 0 NOT NULL,
	"last_interaction_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_relationships_user1_id_user2_id_pk" PRIMARY KEY("user1_id","user2_id")
);
--> statement-breakpoint
CREATE TABLE "user_room_overlaps" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"user1_id" text NOT NULL,
	"user2_id" text NOT NULL,
	"overlap_start" timestamp NOT NULL,
	"overlap_end" timestamp NOT NULL,
	"overlap_seconds" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_room_id_streaming_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."streaming_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaming_rooms" ADD CONSTRAINT "streaming_rooms_streamer_id_users_id_fk" FOREIGN KEY ("streamer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_room_overlaps" ADD CONSTRAINT "user_room_overlaps_room_id_streaming_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."streaming_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_room_overlaps" ADD CONSTRAINT "user_room_overlaps_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_room_overlaps" ADD CONSTRAINT "user_room_overlaps_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_participants_room_idx" ON "room_participants" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_participants_user_idx" ON "room_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_relationships_user1_idx" ON "user_relationships" USING btree ("user1_id");--> statement-breakpoint
CREATE INDEX "user_relationships_user2_idx" ON "user_relationships" USING btree ("user2_id");--> statement-breakpoint
CREATE INDEX "user_relationships_time_idx" ON "user_relationships" USING btree ("total_time_seconds");--> statement-breakpoint
CREATE INDEX "user_room_overlaps_room_idx" ON "user_room_overlaps" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "user_room_overlaps_pair_idx" ON "user_room_overlaps" USING btree ("user1_id","user2_id");