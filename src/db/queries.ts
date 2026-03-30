import { and, desc, eq, gte, inArray, or, sql, sum } from "drizzle-orm";
import { db } from "./index";
import { userRelationships, userRoomOverlaps, users } from "./schema";

export interface RelationshipResult {
	otherUserId: string;
	totalTimeSeconds: number;
	roomsCount: number;
	lastInteractionAt: Date | null;
}

export interface UserResult {
	id: string;
	name: string;
	email: string;
	image: string | null;
	emailVerified: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface RelationshipWithUser extends RelationshipResult {
	user: UserResult | undefined;
}

export interface UserProfileData {
	user: UserResult;
	topRelationships: RelationshipWithUser[];
	topRelationshipsLast30Days: RelationshipWithUser[];
	stats: { totalWatchTime: number; watchTimeLast30Days: number };
}

/**
 * Get top 5 users that a specific user has spent the most time with
 * Returns normalized data (user1Id < user2Id is handled automatically)
 */
export async function getTopRelationships(
	userId: string,
	limit = 5,
): Promise<RelationshipWithUser[]> {
	// Query where the user is either user1 or user2 in the relationship
	const relationships = await db
		.select({
			otherUserId: sql<string>`
				CASE 
					WHEN ${userRelationships.user1Id} = ${userId} THEN ${userRelationships.user2Id}
					ELSE ${userRelationships.user1Id}
					END
			`.as("other_user_id"),
			totalTimeSeconds: userRelationships.totalTimeSeconds,
			roomsCount: userRelationships.roomsCount,
			lastInteractionAt: userRelationships.lastInteractionAt,
		})
		.from(userRelationships)
		.where(
			or(
				eq(userRelationships.user1Id, userId),
				eq(userRelationships.user2Id, userId),
			),
		)
		.orderBy(desc(userRelationships.totalTimeSeconds))
		.limit(limit);

	// Fetch user details for the relationships
	const otherUserIds = relationships.map(
		(r: RelationshipResult) => r.otherUserId,
	);

	if (otherUserIds.length === 0) {
		return [];
	}

	const otherUsers = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			image: users.image,
			emailVerified: users.emailVerified,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt,
		})
		.from(users)
		.where(inArray(users.id, otherUserIds));

	// Combine the data
	return relationships.map((rel: RelationshipResult) => ({
		...rel,
		user: otherUsers.find((u: UserResult) => u.id === rel.otherUserId),
	}));
}

/**
 * Get top users a specific user has shared room time with in the last 30 days
 */
export async function getTopRelationshipsLast30Days(
	userId: string,
	limit = 5,
): Promise<RelationshipWithUser[]> {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	const overlaps = await db
		.select({
			otherUserId: sql<string>`
				CASE
					WHEN ${userRoomOverlaps.user1Id} = ${userId} THEN ${userRoomOverlaps.user2Id}
					ELSE ${userRoomOverlaps.user1Id}
				END
			`.as("other_user_id"),
			totalTimeSeconds: sum(userRoomOverlaps.overlapSeconds).as(
				"total_time_seconds",
			),
			roomsCount: sql<number>`count(distinct ${userRoomOverlaps.roomId})`.as(
				"rooms_count",
			),
		})
		.from(userRoomOverlaps)
		.where(
			and(
				or(
					eq(userRoomOverlaps.user1Id, userId),
					eq(userRoomOverlaps.user2Id, userId),
				),
				gte(userRoomOverlaps.overlapStart, thirtyDaysAgo),
			),
		)
		.groupBy(sql`1`)
		.orderBy(desc(sum(userRoomOverlaps.overlapSeconds)))
		.limit(limit);

	const otherUserIds = overlaps.map((r) => r.otherUserId);

	if (otherUserIds.length === 0) {
		return [];
	}

	const otherUsers = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			image: users.image,
			emailVerified: users.emailVerified,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt,
		})
		.from(users)
		.where(inArray(users.id, otherUserIds));

	return overlaps.map((rel) => ({
		otherUserId: rel.otherUserId,
		totalTimeSeconds: Number(rel.totalTimeSeconds) || 0,
		roomsCount: Number(rel.roomsCount) || 0,
		lastInteractionAt: null,
		user: otherUsers.find((u) => u.id === rel.otherUserId),
	}));
}

/**
 * Get full profile data including top relationships
 */
export async function getUserProfileWithRelationships(
	userId: string,
): Promise<UserProfileData | null> {
	const [userRows, topRelationships] = await Promise.all([
		db
			.select({
				id: users.id,
				name: users.name,
				email: users.email,
				image: users.image,
				emailVerified: users.emailVerified,
				createdAt: users.createdAt,
				updatedAt: users.updatedAt,
			})
			.from(users)
			.where(eq(users.id, userId))
			.limit(1),
		getTopRelationships(userId, 5),
	]);

	const user = userRows[0];

	if (!user) {
		return null;
	}

	return {
		user,
		topRelationships,
	};
}
