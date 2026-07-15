import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { room } from './rooms'

export const roomMembership = pgTable(
  'room_membership',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at').notNull(),
    leftAt: timestamp('left_at'),
  },
  (table) => [
    unique('room_membership_id_room_unique').on(table.id, table.roomId),
    uniqueIndex('room_membership_one_current_account_idx')
      .on(table.accountId)
      .where(sql`${table.leftAt} is null`),
    uniqueIndex('room_membership_one_current_host_idx')
      .on(table.roomId)
      .where(sql`${table.leftAt} is null and ${table.role} = 'host'`),
    index('room_membership_current_room_idx').on(table.roomId, table.leftAt),
    check('room_membership_role_check', sql`${table.role} in ('host', 'member')`),
    check(
      'room_membership_interval_check',
      sql`${table.leftAt} is null or ${table.leftAt} >= ${table.joinedAt}`,
    ),
  ],
)

export const roomBan = pgTable(
  'room_ban',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull(),
    clearedAt: timestamp('cleared_at'),
  },
  (table) => [
    uniqueIndex('room_ban_one_active_idx')
      .on(table.roomId, table.accountId)
      .where(sql`${table.clearedAt} is null`),
    check(
      'room_ban_interval_check',
      sql`${table.clearedAt} is null or ${table.clearedAt} >= ${table.createdAt}`,
    ),
  ],
)
