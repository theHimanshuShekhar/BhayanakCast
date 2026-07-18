import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const chatMute = pgTable(
  'chat_mute',
  {
    mutingAccountId: text('muting_account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    mutedAccountId: text('muted_account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chat_mute_muting_muted_idx').on(
      table.mutingAccountId,
      table.mutedAccountId,
    ),
    index('chat_mute_muted_account_id_idx').on(table.mutedAccountId),
  ],
)
