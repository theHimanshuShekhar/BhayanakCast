CREATE TABLE "message" (
  "id" uuid PRIMARY KEY,
  "room_id" uuid NOT NULL REFERENCES "room"("id"),
  "membership_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp NOT NULL,
  CONSTRAINT "message_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 500),
  CONSTRAINT "message_membership_room_fk" FOREIGN KEY ("membership_id", "room_id")
    REFERENCES "room_membership"("id", "room_id")
);
--> statement-breakpoint
CREATE INDEX "message_room_recent_idx" ON "message" ("room_id", "created_at" DESC, "id" DESC);
