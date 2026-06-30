CREATE TYPE "public"."platform_sanction_type" AS ENUM('stream_ban', 'chat_ban', 'room_creation_ban', 'full_suspension');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('account', 'room', 'stream_session', 'chat_message');--> statement-breakpoint
CREATE TABLE "platform_sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "platform_sanction_type" NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"starts_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"lifted_at" timestamp (3) with time zone,
	CONSTRAINT "platform_sanctions_reason_len_chk" CHECK (char_length("platform_sanctions"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" text NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" text NOT NULL,
	"room_id" uuid,
	"reason" text NOT NULL,
	"details" text,
	"thumbnail_snapshot" "bytea",
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	CONSTRAINT "reports_reason_len_chk" CHECK (char_length("reports"."reason") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "platform_sanctions" ADD CONSTRAINT "platform_sanctions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sanctions" ADD CONSTRAINT "platform_sanctions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_sanctions_effective_idx" ON "platform_sanctions" USING btree ("user_id","type","lifted_at","expires_at");--> statement-breakpoint
CREATE INDEX "reports_created_idx" ON "reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");