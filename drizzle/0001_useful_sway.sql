ALTER TABLE "streaming_rooms" DROP CONSTRAINT "streaming_rooms_streamer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "streaming_rooms" ALTER COLUMN "streamer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "streaming_rooms" ALTER COLUMN "status" SET DEFAULT 'waiting';--> statement-breakpoint
ALTER TABLE "streaming_rooms" ADD CONSTRAINT "streaming_rooms_streamer_id_users_id_fk" FOREIGN KEY ("streamer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;