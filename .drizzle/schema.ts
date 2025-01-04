import { pgTable, unique, integer, uuid, text, timestamp, foreignKey, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const user = pgTable("user", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "user_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	uuid: uuid().defaultRandom().notNull(),
	name: text(),
	avatarUrl: text("avatar_url"),
	email: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	setupAt: timestamp("setup_at", { mode: 'string' }),
}, (table) => [
	unique("user_uuid_unique").on(table.uuid),
	unique("user_email_unique").on(table.email),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_user_id_user_id_fk"
		}),
]);

export const userRoom = pgTable("user_room", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "user_room_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	userUuid: uuid("user_uuid").notNull(),
	roomUuid: uuid("room_uuid").notNull(),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userUuid],
			foreignColumns: [user.uuid],
			name: "user_room_user_uuid_user_uuid_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.roomUuid],
			foreignColumns: [room.uuid],
			name: "user_room_room_uuid_room_uuid_fk"
		}).onDelete("cascade"),
]);

export const room = pgTable("room", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "room_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	uuid: uuid().defaultRandom().notNull(),
	name: text(),
	bannerUrl: text("banner_url"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	unique("room_uuid_unique").on(table.uuid),
]);

export const oauthAccount = pgTable("oauth_account", {
	providerId: text("provider_id").notNull(),
	providerUserId: text("provider_user_id").notNull(),
	userId: integer("user_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "oauth_account_user_id_user_id_fk"
		}),
	primaryKey({ columns: [table.providerId, table.providerUserId], name: "oauth_account_provider_id_provider_user_id_pk"}),
]);
