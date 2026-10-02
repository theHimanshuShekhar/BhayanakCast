CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "user_discord_username_idx";--> statement-breakpoint
CREATE INDEX "user_username_trgm_idx" ON "user" USING gin ((coalesce("discord_username", "name")) gin_trgm_ops);