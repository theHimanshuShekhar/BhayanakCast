CREATE TABLE "anonymized_subject" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "enforcement_key" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "anonymized_subject_enforcement_key_idx" ON "anonymized_subject" USING btree ("enforcement_key") WHERE "anonymized_subject"."enforcement_key" is not null;
--> statement-breakpoint
ALTER TABLE "platform_sanction" DROP CONSTRAINT "platform_sanction_account_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_sanction" ALTER COLUMN "account_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD COLUMN "subject_id" uuid;
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_subject_id_anonymized_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "anonymized_subject"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_subject_check" CHECK (num_nonnulls("account_id", "subject_id") = 1);
--> statement-breakpoint
CREATE INDEX "platform_sanction_subject_id_idx" ON "platform_sanction" USING btree ("subject_id");
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_subject_ref_fk" FOREIGN KEY ("reporter_subject_ref") REFERENCES "anonymized_subject"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_subject_ref_fk" FOREIGN KEY ("subject_ref") REFERENCES "anonymized_subject"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_subject_check" CHECK (num_nonnulls("reporter_account_id", "reporter_subject_ref") = 1);
--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_target_subject_check" CHECK (("target_type" = 'account' AND (("subject_ref" is null AND "target_id" <> 'anonymized') OR ("subject_ref" is not null AND "target_id" = 'anonymized'))) OR ("target_type" <> 'account' AND "subject_ref" is null));
--> statement-breakpoint
CREATE TABLE "retention_run_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ran_at" timestamp NOT NULL,
  "transcript_rows_deleted" integer NOT NULL,
  "report_rows_deleted" integer NOT NULL,
  "enforcement_keys_expired" integer NOT NULL,
  CONSTRAINT "retention_run_audit_counts_check" CHECK ("transcript_rows_deleted" >= 0 AND "report_rows_deleted" >= 0 AND "enforcement_keys_expired" >= 0)
);
--> statement-breakpoint
CREATE INDEX "retention_run_audit_ran_at_idx" ON "retention_run_audit" USING btree ("ran_at" DESC);
