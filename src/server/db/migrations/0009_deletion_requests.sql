CREATE TABLE "deletion_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "resolved_by" text,
  CONSTRAINT "deletion_request_status_check" CHECK ("deletion_request"."status" in ('pending', 'cancelled', 'rejected', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "deletion_request_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "event" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "actor_id" text,
  CONSTRAINT "deletion_request_audit_event_check" CHECK ("deletion_request_audit"."event" in ('submitted', 'cancelled', 'rejected', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "deletion_request" ADD CONSTRAINT "deletion_request_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_request_audit" ADD CONSTRAINT "deletion_request_audit_request_id_deletion_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "deletion_request"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_request_audit" ADD CONSTRAINT "deletion_request_audit_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deletion_request_audit" ADD CONSTRAINT "deletion_request_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "deletion_request_account_id_idx" ON "deletion_request" USING btree ("account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_request_pending_account_idx" ON "deletion_request" USING btree ("account_id") WHERE "deletion_request"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "deletion_request_audit_request_id_idx" ON "deletion_request_audit" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "deletion_request_audit_account_id_idx" ON "deletion_request_audit" USING btree ("account_id");
