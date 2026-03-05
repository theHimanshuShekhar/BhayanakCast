import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./index";
import { userRelationships, users } from "./schema";

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
