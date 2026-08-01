ALTER TABLE "report" DROP CONSTRAINT "report_reporter_fk";
--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "reporter_account_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "reporter_subject_ref" uuid;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "subject_ref" uuid;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "resolved_by_account_id" text;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "resolved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "retain_until" timestamp;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "evidence_content" bytea;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "evidence_content_type" text;
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "evidence_captured_at" timestamp;
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_fk" FOREIGN KEY ("reporter_account_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolved_by_fk" FOREIGN KEY ("resolved_by_account_id") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_status_check" CHECK ("status" in ('pending', 'resolved', 'dismissed'));
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_resolution_check" CHECK (("status" = 'pending' and "resolved_by_account_id" is null and "resolved_at" is null and "retain_until" is null) or ("status" in ('resolved', 'dismissed') and "resolved_by_account_id" is not null and "resolved_at" is not null and "retain_until" = "resolved_at" + interval '1 year'));
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_evidence_check" CHECK (("evidence_content" is null and "evidence_content_type" is null and "evidence_captured_at" is null) or ("target_type" = 'stream' and "evidence_content" is not null and "evidence_content_type" = 'image/webp' and "evidence_captured_at" is not null));
--> statement-breakpoint
CREATE INDEX "report_status_queue_idx" ON "report" USING btree ("status", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE "report_audit" (
  "id" uuid PRIMARY KEY NOT NULL,
  "report_id" uuid NOT NULL,
  "admin_account_id" text NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp NOT NULL,
  CONSTRAINT "report_audit_action_check" CHECK ("action" in ('resolved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "report_audit" ADD CONSTRAINT "report_audit_report_fk" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report_audit" ADD CONSTRAINT "report_audit_admin_fk" FOREIGN KEY ("admin_account_id") REFERENCES "user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "report_audit_report_idx" ON "report_audit" USING btree ("report_id", "created_at");
