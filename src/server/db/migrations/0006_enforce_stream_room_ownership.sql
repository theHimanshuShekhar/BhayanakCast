ALTER TABLE "stream" DROP CONSTRAINT "stream_membership_id_room_membership_id_fk";
--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_id_room_unique" UNIQUE("id","room_id");--> statement-breakpoint
ALTER TABLE "stream" ADD CONSTRAINT "stream_membership_room_fk" FOREIGN KEY ("membership_id","room_id") REFERENCES "room_membership"("id","room_id") ON DELETE no action ON UPDATE no action;