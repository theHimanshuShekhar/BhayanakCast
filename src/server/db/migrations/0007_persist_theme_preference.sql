CREATE TABLE "account_preference" (
  "account_id" text PRIMARY KEY NOT NULL,
  "theme" text,
  CONSTRAINT "account_preference_theme_check" CHECK ("theme" IS NULL OR "theme" IN ('light', 'dark'))
);
--> statement-breakpoint
ALTER TABLE "account_preference" ADD CONSTRAINT "account_preference_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
