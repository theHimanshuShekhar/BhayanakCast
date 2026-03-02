import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "#/db/index";
import { getTopRelationships, type UserProfileData } from "#/db/queries";
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

		const topRelationships = await getTopRelationships(data.userId, 5);

		return {
			user: user[0],
			topRelationships,
		};
	});
