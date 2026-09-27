/** Favorites are a badge only (ADR 19). */
import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

export const favorites = pgTable(
  "favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    favoriteUserId: text("favorite_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.favoriteUserId] }),
    index("favorites_favorite_user_id_idx").on(table.favoriteUserId),
    check("favorites_not_self", sql`${table.userId} <> ${table.favoriteUserId}`),
  ],
);
