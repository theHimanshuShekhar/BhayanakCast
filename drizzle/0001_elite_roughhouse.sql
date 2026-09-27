CREATE TABLE "host_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "host_intervals_order" CHECK ("host_intervals"."ended_at" is null or "host_intervals"."ended_at" >= "host_intervals"."started_at")
);
--> statement-breakpoint
ALTER TABLE "host_intervals" ADD CONSTRAINT "host_intervals_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_intervals" ADD CONSTRAINT "host_intervals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_intervals_room_idx" ON "host_intervals" USING btree ("room_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "host_intervals_one_open_idx" ON "host_intervals" USING btree ("room_id") WHERE "host_intervals"."ended_at" is null;