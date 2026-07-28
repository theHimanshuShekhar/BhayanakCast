import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { roomMembership } from './memberships'
import { room } from './rooms'

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id),
    membershipId: uuid('membership_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.membershipId, table.roomId],
      foreignColumns: [roomMembership.id, roomMembership.roomId],
      name: 'message_membership_room_fk',
    }),
    // ADR 0071 reads the newest 50 for a room on admission; this index is that
    // query's access path.
    index('message_room_recent_idx').on(table.roomId, table.createdAt, table.id),
    check(
      'message_body_length_check',
      sql`char_length(${table.body}) between 1 and 500`,
    ),
  ],
)
