import { sql } from 'drizzle-orm'
import { check, pgTable, text } from 'drizzle-orm/pg-core'
import { user } from './auth'

export const accountPreference = pgTable(
  'account_preference',
  {
    accountId: text('account_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    theme: text('theme'),
  },
  (table) => [
    check(
      'account_preference_theme_check',
      sql`${table.theme} is null or ${table.theme} in ('light', 'dark')`,
    ),
  ],
)
