import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

// Better Auth tables
export const users = pgTable("users", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull(),
	image: text("image"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const sessions = pgTable("sessions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = pgTable("accounts", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at"),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export const verifications = pgTable("verifications", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	createdAt: timestamp("created_at"),
	updatedAt: timestamp("updated_at"),
});

// Streaming rooms - tracks active and past streaming sessions
export const streamingRooms = pgTable("streaming_rooms", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	streamerId: text("streamer_id").references(() => users.id, {
		onDelete: "set null",
	}),
	status: text("status").notNull().default("waiting"), // waiting, preparing, active, ended
	createdAt: timestamp("created_at").notNull().defaultNow(),
	endedAt: timestamp("ended_at"),
});

// Room participants - tracks when users join and leave rooms
export const roomParticipants = pgTable(
	"room_participants",
	{
		id: text("id").primaryKey(),
		roomId: text("room_id")
			.notNull()
			.references(() => streamingRooms.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		joinedAt: timestamp("joined_at").notNull().defaultNow(),
		leftAt: timestamp("left_at"),
		totalTimeSeconds: integer("total_time_seconds").default(0),
	},
	(table) => ({
		roomIdx: index("room_participants_room_idx").on(table.roomId),
		userIdx: index("room_participants_user_idx").on(table.userId),
	}),
);

// User relationships - normalized (user1_id < user2_id), aggregated time spent together
export const userRelationships = pgTable(
	"user_relationships",
	{
		user1Id: text("user1_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		user2Id: text("user2_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		totalTimeSeconds: integer("total_time_seconds").notNull().default(0),
		roomsCount: integer("rooms_count").notNull().default(0),
		lastInteractionAt: timestamp("last_interaction_at"),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.user1Id, table.user2Id] }),
		user1Idx: index("user_relationships_user1_idx").on(table.user1Id),
		user2Idx: index("user_relationships_user2_idx").on(table.user2Id),
		timeIdx: index("user_relationships_time_idx").on(table.totalTimeSeconds),
	}),
);

// Detailed overlap logs - for periodic recalculation and auditing
export const userRoomOverlaps = pgTable(
	"user_room_overlaps",
	{
		id: text("id").primaryKey(),
		roomId: text("room_id")
			.notNull()
			.references(() => streamingRooms.id, { onDelete: "cascade" }),
		user1Id: text("user1_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		user2Id: text("user2_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		overlapStart: timestamp("overlap_start").notNull(),
		overlapEnd: timestamp("overlap_end").notNull(),
		overlapSeconds: integer("overlap_seconds").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		roomIdx: index("user_room_overlaps_room_idx").on(table.roomId),
		userPairIdx: index("user_room_overlaps_pair_idx").on(
			table.user1Id,
			table.user2Id,
		),
	}),
);

// Relations for easier querying
export const usersRelations = relations(users, ({ many }) => ({
	streamingRooms: many(streamingRooms),
	roomParticipants: many(roomParticipants),
	relationshipsAsUser1: many(userRelationships, { relationName: "user1" }),
	relationshipsAsUser2: many(userRelationships, { relationName: "user2" }),
}));

export const streamingRoomsRelations = relations(
	streamingRooms,
	({ one, many }) => ({
		streamer: one(users, {
			fields: [streamingRooms.streamerId],
			references: [users.id],
		}),
		participants: many(roomParticipants),
		overlaps: many(userRoomOverlaps),
	}),
);

export const roomParticipantsRelations = relations(
	roomParticipants,
	({ one }) => ({
		room: one(streamingRooms, {
			fields: [roomParticipants.roomId],
			references: [streamingRooms.id],
		}),
		user: one(users, {
			fields: [roomParticipants.userId],
			references: [users.id],
		}),
	}),
);

export const userRelationshipsRelations = relations(
	userRelationships,
	({ one }) => ({
		user1: one(users, {
			fields: [userRelationships.user1Id],
			references: [users.id],
			relationName: "user1",
		}),
		user2: one(users, {
			fields: [userRelationships.user2Id],
			references: [users.id],
			relationName: "user2",
		}),
	}),
);
