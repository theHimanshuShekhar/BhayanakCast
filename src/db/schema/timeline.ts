/**
 * The room timeline (CONTEXT.md; ADR 4 addendum on the write path, ADR 11 addendum on what is kept): one row per thing that happened in
 * a room, for an admin to diagnose it. Kept 90 days, longer than the 30 of room data, so like
 * quality samples and the admin audit log it has no foreign keys, to `rooms` or `user`: the room
 * purge can't take it, and a deleted account leaves its ids. Its own daily purge is
 * `purgeExpiredTimelineEvents` (src/server/room-timeline.ts).
 */
import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { TimelineDetails, TimelineEventKind } from "../../lib/room-timeline.ts";

export const roomTimelineEvents = pgTable(
  "room_timeline_events",
  {
    /** Insertion order, which breaks ties between events in the same millisecond. */
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    roomId: text("room_id").notNull(),
    /** When it happened, by the server's clock (ADR 12). */
    at: timestamp("at", { withTimezone: true }).notNull(),
    kind: text("kind").$type<TimelineEventKind>().notNull(),
    /** Who did it (a kicker, a joiner), and who it was done to, if anyone. Real user ids. */
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    /** A small bounded record of the particulars (`boundDetails`); never chat content. */
    details: jsonb("details").$type<TimelineDetails>().default({}).notNull(),
  },
  (table) => [
    index("room_timeline_events_room_idx").on(table.roomId, table.at),
    index("room_timeline_events_at_idx").on(table.at),
  ],
);
