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
    .notNull()
    .$onUpdate(() => new Date()),
});

export const roomStreamer = relations(room, ({ one }) => ({
  roomStreamer: one(user, {
    fields: [room.streamer],
    references: [user.id],
  }),
}));

export const roomViewers = relations(room, ({ many }) => ({
  viewers: many(user),
}));

export const viewerRelations = relations(user, ({ one }) => ({
  joinedRoom: one(room, {
    fields: [user.joinedRoomId],
    references: [room.id],
  }),
}));
