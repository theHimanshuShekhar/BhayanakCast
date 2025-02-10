import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uuid: uuid().defaultRandom().unique().notNull(),
  name: text(),
  avatar_url: text(),
  email: text().unique().notNull(),

  created_at: timestamp().defaultNow().notNull(),
  updated_at: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date()),
  setup_at: timestamp(),
});

export const oauthAccount = pgTable(
  "oauth_account",
  {
    provider_id: text().notNull(),
    provider_user_id: text().notNull(),
    user_id: integer()
      .notNull()
      .references(() => user.id),
  },
  (table) => [primaryKey({ columns: [table.provider_id, table.provider_user_id] })],
);

export const session = pgTable("session", {
  id: text().primaryKey(),
  user_id: integer()
    .notNull()
    .references(() => user.id),
  expires_at: timestamp({
    withTimezone: true,
    mode: "date",
  }).notNull(),
});

export const room = pgTable("room", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uuid: uuid().defaultRandom().unique().notNull(),
  name: text(),
  banner_url: text(),
  streamer: text(),

  created_at: timestamp().defaultNow().notNull(),
  updated_at: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const userRoom = pgTable("user_room", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_uuid: uuid()
    .notNull()
    .references(() => user.uuid, { onDelete: "cascade" }),
  room_uuid: uuid()
    .notNull()
    .references(() => room.uuid, { onDelete: "cascade" }),

  joined_at: timestamp().defaultNow().notNull(),
});

export type Room = typeof room.$inferSelect;
export type UserRoom = typeof userRoom.$inferSelect;
export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
