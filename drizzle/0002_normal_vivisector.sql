CREATE TABLE "community_stats_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"total_registered_users" integer NOT NULL,
	"total_watch_hours_this_week" integer NOT NULL,
	"total_watch_seconds_this_week" integer DEFAULT 0 NOT NULL,
	"most_active_streamers" integer NOT NULL,
	"new_users_this_week" integer NOT NULL,
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "community_stats_calculated_at_idx" ON "community_stats_snapshots" USING btree ("calculated_at");