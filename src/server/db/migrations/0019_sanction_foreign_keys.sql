ALTER TABLE "platform_sanction" DROP CONSTRAINT "platform_sanction_account_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_sanction" DROP CONSTRAINT "platform_sanction_origin_sanction_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_sanction" ADD CONSTRAINT "platform_sanction_origin_sanction_id_fk" FOREIGN KEY ("origin_sanction_id") REFERENCES "platform_sanction"("id") ON DELETE no action ON UPDATE no action;
