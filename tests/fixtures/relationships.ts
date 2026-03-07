export const testRelationships = [
	{
		user1Id: "user-1",
		user2Id: "user-2",
		totalTimeSeconds: 5400,
		roomsCount: 2,
		lastInteractionAt: new Date(Date.now() - 3000000),
		updatedAt: new Date(Date.now() - 3000000),
	},
	{
		user1Id: "user-1",
		user2Id: "user-3",
		totalTimeSeconds: 2700,
		roomsCount: 1,
		lastInteractionAt: new Date(Date.now() - 300000),
		updatedAt: new Date(Date.now() - 300000),
	},
	{
		user1Id: "user-2",
		user2Id: "user-3",
		totalTimeSeconds: 2400,
		roomsCount: 1,
		lastInteractionAt: new Date(Date.now() - 2400000),
		updatedAt: new Date(Date.now() - 2400000),
	},
];

export async function insertTestRelationships(db: any) {
	const { userRelationships } = await import("../../src/db/schema");
	await db.insert(userRelationships).values(testRelationships);
}
