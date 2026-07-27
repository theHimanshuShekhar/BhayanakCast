ALTER TABLE "room_membership"
  ADD COLUMN "reconnect_until" timestamp;
--> statement-breakpoint
ALTER TABLE "room"
  ADD COLUMN "warning_30_sent_at" timestamp,
  ADD COLUMN "warning_10_sent_at" timestamp,
  ADD COLUMN "warning_1_sent_at" timestamp;
