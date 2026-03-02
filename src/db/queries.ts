// Example queries for user relationships
// These show how to get the top 5 users someone spent time with

import { desc, eq, or, sql } from "drizzle-orm";
import { db } from "./index";
import { userRelationships, users } from "./schema";

interface RelationshipResult {
	otherUserId: string;
	totalTimeSeconds: number;
	roomsCount: number;
	lastInteractionAt: Date | null;
}

interface UserResult {
	id: string;
	name: string;
	image: string | null;
}

interface RelationshipWithUser extends RelationshipResult {
	user: UserResult | undefined;
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
			image: users.image,
		})
		.from(users)
		.where(sql`${users.id} IN (${sql.join(otherUserIds)})`);

	// Combine the data
	return relationships.map((rel: RelationshipResult) => ({
		...rel,
		user: otherUsers.find((u: UserResult) => u.id === rel.otherUserId),
	}));
}

/**
 * Get full profile data including top relationships
 */
export async function getUserProfileWithRelationships(userId: string) {
	const [user, topRelationships] = await Promise.all([
		db.select().from(users).where(eq(users.id, userId)).limit(1),
		getTopRelationships(userId, 5),
	]);

	if (!user[0]) {
		return null;
	}

	return {
		user: user[0],
		topRelationships,
	};
}

// Example usage in a React component:
/*
const ProfilePage = () => {
  const { userId } = useParams();

  const { data: profile } = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => getUserProfileWithRelationships(userId),
  });

  return (
    <div>
      <h1>{profile?.user.name}</h1>

      <h2>Top People You've Spent Time With:</h2>
      <ul>
        {profile?.topRelationships.map((rel, index) => (
          <li key={rel.otherUserId}>
            #{index + 1} {rel.user?.name}
            <span>
              {Math.floor(rel.totalTimeSeconds / 3600)}h{" "}
              {Math.floor((rel.totalTimeSeconds % 3600) / 60)}m
            </span>
            <span>in {rel.roomsCount} rooms</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
*/
