CREATE TABLE "past_stream_thumbnail" (
  "room_id" uuid PRIMARY KEY NOT NULL,
  "stream_id" uuid NOT NULL,
  "bytes" bytea NOT NULL,
  "captured_at" timestamp NOT NULL,
  CONSTRAINT "past_stream_thumbnail_byte_limit_check" CHECK (octet_length("bytes") <= 102400)
);
--> statement-breakpoint
ALTER TABLE "past_stream_thumbnail" ADD CONSTRAINT "past_stream_thumbnail_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "past_stream_thumbnail" ADD CONSTRAINT "past_stream_thumbnail_stream_id_stream_id_fk" FOREIGN KEY ("stream_id") REFERENCES "stream"("id") ON DELETE no action ON UPDATE no action;
