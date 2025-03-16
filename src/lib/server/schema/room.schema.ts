import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm/relations";
import { user } from "./auth.schema";

export const room = pgTable("room", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  image: text("image"),
  streamer: text("streamer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const roomStreamer = relations(room, ({ one }) => ({
  invitee: one(user, {
    fields: [room.streamer],
    references: [user.id],
  }),
}));

export const roomViewers = relations(room, ({ many }) => ({
  user: many(user),
}));

export const viewerRelations = relations(user, ({ one }) => ({
  author: one(room, {
    fields: [user.room],
    references: [room.id],
  }),
}));
