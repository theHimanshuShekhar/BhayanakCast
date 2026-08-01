ALTER TABLE "message" ADD COLUMN "mutation_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "message_membership_mutation_idx"
  ON "message" ("membership_id", "mutation_id");
