CREATE TYPE "public"."quality_codec_reason" AS ENUM('preferred', 'hardware', 'browser', 'cpu');--> statement-breakpoint
ALTER TYPE "public"."quality_trigger" ADD VALUE 'codec';--> statement-breakpoint
ALTER TABLE "quality_samples" ADD COLUMN "codec_reason" "quality_codec_reason";--> statement-breakpoint
ALTER TABLE "quality_samples" ADD COLUMN "from_codec" text;--> statement-breakpoint
ALTER TABLE "quality_samples" ADD COLUMN "encoder_implementation" text;--> statement-breakpoint
ALTER TABLE "quality_samples" ADD COLUMN "power_efficient_encoder" boolean;--> statement-breakpoint
ALTER TABLE "quality_samples" ADD COLUMN "encode_ms" real;