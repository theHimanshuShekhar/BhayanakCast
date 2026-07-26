CREATE TABLE "chat_mute" (
  "muting_account_id" text NOT NULL,
  "muted_account_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_mute" ADD CONSTRAINT "chat_mute_muting_account_id_user_id_fk" FOREIGN KEY ("muting_account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_mute" ADD CONSTRAINT "chat_mute_muted_account_id_user_id_fk" FOREIGN KEY ("muted_account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_mute_muting_muted_idx" ON "chat_mute" USING btree ("muting_account_id", "muted_account_id");
--> statement-breakpoint
CREATE INDEX "chat_mute_muted_account_id_idx" ON "chat_mute" USING btree ("muted_account_id");
