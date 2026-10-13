CREATE TABLE "room_timeline_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "room_timeline_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"room_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_timeline_events_room_idx" ON "room_timeline_events" USING btree ("room_id","at");--> statement-breakpoint
CREATE INDEX "room_timeline_events_at_idx" ON "room_timeline_events" USING btree ("at");