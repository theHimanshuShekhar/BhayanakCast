/**
 * Persistent aggregates (ADR 11). These tables deliberately have NO foreign key
 * to `rooms`, so the 30-day room purge can never cascade into them.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

export const userStats = pgTable("user_stats", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  secondsStreamed: bigint("seconds_streamed", { mode: "number" }).default(0).notNull(),
  secondsWatched: bigint("seconds_watched", { mode: "number" }).default(0).notNull(),
  roomsHosted: integer("rooms_hosted").default(0).notNull(),
  roomsJoined: integer("rooms_joined").default(0).notNull(),
  /** Most other people simultaneously present while this user was streaming. */
  peakViewers: integer("peak_viewers").default(0).notNull(),
});

/** Pairwise co-time. Each pair is stored once with userA < userB. */
export const userCotime = pgTable(
  "user_cotime",
  {
    userA: text("user_a")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userB: text("user_b")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secondsTogether: bigint("seconds_together", { mode: "number" }).default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userA, table.userB] }),
    index("user_cotime_user_b_idx").on(table.userB),
    check("user_cotime_ordered", sql`${table.userA} < ${table.userB}`),
  ],
);

/** Platform counters behind the admin charts, keyed by UTC day. */
export const dailyPlatformStats = pgTable("daily_platform_stats", {
  day: date("day", { mode: "string" }).primaryKey(),
  newUsers: integer("new_users").default(0).notNull(),
  roomsCreated: integer("rooms_created").default(0).notNull(),
  roomsEnded: integer("rooms_ended").default(0).notNull(),
});
