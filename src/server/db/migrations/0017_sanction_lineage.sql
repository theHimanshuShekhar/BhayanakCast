ALTER TABLE "platform_sanction" ADD COLUMN "origin_sanction_id" uuid;
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_origin_sanction_id_fk" FOREIGN KEY ("origin_sanction_id") REFERENCES "platform_sanction"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_sanction_origin_account_idx" ON "platform_sanction" USING btree ("account_id", "origin_sanction_id") WHERE "platform_sanction"."origin_sanction_id" is not null;
