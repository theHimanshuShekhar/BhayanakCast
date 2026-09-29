/**
 * The admin audit log (ADR 6 addendum, spec #7): one row per admin action, kept indefinitely
 * (ADR 11 addendum). It has no foreign keys, to `rooms` or `user`, so neither the 30-day room
 * purge nor a deleted account can take rows with it: the trail keeps the ids.
 */
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** What an admin did. */
export const adminActionKind = pgEnum("admin_action_kind", [
  "ban",
  "unban",
  "promote",
  "demote",
  "end_room",
]);
export type AdminActionKind = (typeof adminActionKind.enumValues)[number];

export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The admin who acted. */
    actorUserId: text("actor_user_id").notNull(),
    action: adminActionKind("action").notNull(),
    /** The user acted on, if any. */
    targetUserId: text("target_user_id"),
    /** The room acted on, if any. */
    targetRoomId: text("target_room_id"),
    /** What the action carried (a ban's reason and expiry, say). */
    details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("admin_actions_at_idx").on(table.at),
    index("admin_actions_target_user_idx").on(table.targetUserId),
  ],
);
