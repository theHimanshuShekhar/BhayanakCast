import { sql } from 'drizzle-orm'
import { check, customType, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { room } from './rooms'
import { stream } from './streams'

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
})

export const pastStreamThumbnail = pgTable(
  'past_stream_thumbnail',
  {
    roomId: uuid('room_id')
      .primaryKey()
      .references(() => room.id, { onDelete: 'cascade' }),
    streamId: uuid('stream_id')
      .notNull()
      .references(() => stream.id),
    bytes: bytea('bytes').notNull(),
    capturedAt: timestamp('captured_at').notNull(),
  },
  (table) => [
    check(
      'past_stream_thumbnail_byte_limit_check',
      sql`octet_length(${table.bytes}) <= ${100 * 1024}`,
    ),
  ],
)
