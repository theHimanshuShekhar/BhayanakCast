CREATE TABLE "report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_account_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"room_id" uuid,
	"reason" text NOT NULL,
	"details" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "report_target_type_check" CHECK ("target_type" in ('account', 'room', 'stream', 'message')),
	CONSTRAINT "report_reason_check" CHECK ("reason" in ('harassment', 'sexual', 'violence', 'privacy', 'spam', 'copyright', 'other')),
	CONSTRAINT "report_details_check" CHECK ("reason" <> 'other' or ("details" is not null and char_length("details") > 0)),
	CONSTRAINT "report_details_length_check" CHECK ("details" is null or char_length("details") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_fk" FOREIGN KEY ("reporter_account_id") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_room_fk" FOREIGN KEY ("room_id") REFERENCES "room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_queue_idx" ON "report" USING btree ("created_at" DESC);
