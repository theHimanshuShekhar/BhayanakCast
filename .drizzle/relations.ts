import { relations } from "drizzle-orm/relations";
import { user, session, userRoom, room, oauthAccount } from "./schema";

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	sessions: many(session),
	userRooms: many(userRoom),
	oauthAccounts: many(oauthAccount),
}));

export const userRoomRelations = relations(userRoom, ({one}) => ({
	user: one(user, {
		fields: [userRoom.userUuid],
		references: [user.uuid]
	}),
	room: one(room, {
		fields: [userRoom.roomUuid],
		references: [room.uuid]
	}),
}));

export const roomRelations = relations(room, ({many}) => ({
	userRooms: many(userRoom),
}));

export const oauthAccountRelations = relations(oauthAccount, ({one}) => ({
	user: one(user, {
		fields: [oauthAccount.userId],
		references: [user.id]
	}),
}));