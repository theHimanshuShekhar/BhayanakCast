import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "#/db/index";
import {
	getTopRelationships,
	getTopRelationshipsLast30Days,
	type UserProfileData,
} from "#/db/queries";
import { getUserStats } from "#/db/queries/stats";
import { users } from "#/db/schema";

export const getProfileData = createServerFn({ method: "GET" })
	.inputValidator((data: { userId: string }) => data)
	.handler(async ({ data }): Promise<UserProfileData | null> => {
		const user = await db
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
			.where(eq(users.id, data.userId))
			.limit(1);

		if (!user[0]) {
			return null;
		}

		const [topRelationships, topRelationshipsLast30Days, userStats] =
			await Promise.all([
				getTopRelationships(data.userId, 5),
				getTopRelationshipsLast30Days(data.userId, 5),
				getUserStats(data.userId),
			]);

		return {
			user: user[0],
			topRelationships,
			topRelationshipsLast30Days,
			stats: {
				totalWatchTime: userStats.totalWatchTime,
				watchTimeLast30Days: userStats.watchTimeLast30Days,
			},
		};
	});
