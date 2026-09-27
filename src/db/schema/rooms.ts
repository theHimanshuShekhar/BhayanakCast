/**
 * Room-scoped data (ADRs 10, 11, 12, 14, 15, 16). Everything here references
 * `rooms` with ON DELETE CASCADE so the 30-day purge removes it in one delete.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { newInviteToken, newRoomId } from "../ids.ts";
import { user } from "./auth.ts";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

export const roomKind = pgEnum("room_kind", ["gaming", "code", "music", "art", "watch", "chat"]);
export const roomRole = pgEnum("room_role", ["host", "mod", "member"]);

export const rooms = pgTable(
  "rooms",
  {
    id: text("id").primaryKey().$defaultFn(newRoomId),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    kind: roomKind("kind").default("chat").notNull(),
    tags: text("tags").array().default(sql`'{}'::text[]`).notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    /** Unguessable invite token for private rooms; regenerate to invalidate old links (ADR 16). */
    inviteToken: text("invite_token").unique().$defaultFn(newInviteToken),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    hostUserId: text("host_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** When the room last became empty; null while occupied (ADR 14). */
    lastEmptyAt: timestamp("last_empty_at", { withTimezone: true }),
    /** Set when the room ends; equals the time it last became empty (ADR 14). */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    peakParticipants: integer("peak_participants").default(0).notNull(),
    lastThumbnailAt: timestamp("last_thumbnail_at", { withTimezone: true }),
    /** Set once aggregates have been rolled into the persistent stats tables (ADR 11). */
    statsRolledUpAt: timestamp("stats_rolled_up_at", { withTimezone: true }),
  },
  (table) => [
    index("rooms_live_idx").on(table.createdAt).where(sql`${table.endedAt} is null`),
    index("rooms_ended_at_idx").on(table.endedAt),
    index("rooms_created_by_idx").on(table.createdBy),
  ],
);

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roomRole("role").default("member").notNull(),
    /** Kicked users can't rejoin this room (ADR 15). */
    kicked: boolean("kicked").default(false).notNull(),
    /** Knock approved for a private room (ADR 16). Public rooms don't use it. */
    approved: boolean("approved").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index("room_members_user_id_idx").on(table.userId),
  ],
);

export const presenceIntervals = pgTable(
  "presence_intervals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Null while the interval is open. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Periodic checkpoint so a crash can close the interval at last-seen (ADR 12). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("presence_intervals_room_idx").on(table.roomId, table.startedAt),
    index("presence_intervals_user_idx").on(table.userId),
    uniqueIndex("presence_intervals_one_open_idx")
      .on(table.roomId, table.userId)
      .where(sql`${table.endedAt} is null`),
    check(
      "presence_intervals_order",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const streamIntervals = pgTable(
  "stream_intervals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("stream_intervals_room_idx").on(table.roomId, table.startedAt),
    index("stream_intervals_user_idx").on(table.userId),
    uniqueIndex("stream_intervals_one_open_idx")
      .on(table.roomId, table.userId)
      .where(sql`${table.endedAt} is null`),
    check(
      "stream_intervals_order",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

/** Latest thumbnail per streamer per room, overwritten on each upload (ADR 10). */
export const thumbnails = pgTable(
  "thumbnails",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    image: bytea("image").notNull(),
    mime: text("mime").default("image/webp").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.userId] })],
);
