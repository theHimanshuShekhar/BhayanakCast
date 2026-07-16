import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'

export const room = pgTable(
  'room',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    category: text('category'),
    tags: text('tags').array().default(sql`'{}'::text[]`).notNull(),
    visibility: text('visibility').notNull(),
    passwordHash: text('password_hash'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: timestamp('created_at').notNull(),
    emptyAt: timestamp('empty_at'),
    endedAt: timestamp('ended_at'),
  },
  (table) => [
    index('room_active_activity_idx').on(table.endedAt, table.createdAt),
    check(
      'room_visibility_check',
      sql`${table.visibility} in ('public', 'private')`,
    ),
    check('room_tag_count_check', sql`cardinality(${table.tags}) <= 5`),
    check(
      'room_password_check',
      sql`(${table.visibility} = 'public' and ${table.passwordHash} is null) or (${table.visibility} = 'private' and ${table.passwordHash} is not null)`,
    ),
    check(
      'room_end_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.createdAt}`,
    ),
  ],
)
