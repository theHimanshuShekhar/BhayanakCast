CREATE TABLE "user_daily_facts" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"streamed_seconds" integer DEFAULT 0 NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"rooms_hosted" integer DEFAULT 0 NOT NULL,
	"rooms_joined" integer DEFAULT 0 NOT NULL,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"reports_created" integer DEFAULT 0 NOT NULL,
	"reports_received" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_daily_facts_nonnegative_chk" CHECK ("user_daily_facts"."streamed_seconds" >= 0 and "user_daily_facts"."watched_seconds" >= 0 and "user_daily_facts"."rooms_hosted" >= 0 and "user_daily_facts"."rooms_joined" >= 0 and "user_daily_facts"."peak_viewers" >= 0 and "user_daily_facts"."reports_created" >= 0 and "user_daily_facts"."reports_received" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_pair_daily_facts" (
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"day" date NOT NULL,
	"seconds_together" integer DEFAULT 0 NOT NULL,
	"rooms_together" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pair_daily_facts_order_chk" CHECK ("user_pair_daily_facts"."user_a_id" < "user_pair_daily_facts"."user_b_id"),
	CONSTRAINT "user_pair_daily_facts_nonnegative_chk" CHECK ("user_pair_daily_facts"."seconds_together" >= 0 and "user_pair_daily_facts"."rooms_together" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_daily_facts" ADD CONSTRAINT "user_daily_facts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pair_daily_facts" ADD CONSTRAINT "user_pair_daily_facts_user_a_id_user_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pair_daily_facts" ADD CONSTRAINT "user_pair_daily_facts_user_b_id_user_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_daily_facts_user_day_idx" ON "user_daily_facts" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "user_daily_facts_day_idx" ON "user_daily_facts" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "user_pair_daily_facts_pair_day_idx" ON "user_pair_daily_facts" USING btree ("user_a_id","user_b_id","day");--> statement-breakpoint
CREATE INDEX "user_pair_daily_facts_user_a_idx" ON "user_pair_daily_facts" USING btree ("user_a_id","day");--> statement-breakpoint
CREATE INDEX "user_pair_daily_facts_user_b_idx" ON "user_pair_daily_facts" USING btree ("user_b_id","day");