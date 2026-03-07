export const testRooms = [
	{
		id: "room-1",
		name: "Gaming Stream",
		description: "Playing some games",
		streamerId: "user-1",
		status: "active",
		createdAt: new Date(Date.now() - 3600000),
		endedAt: null,
	},
	{
		id: "room-2",
		name: "Coding Session",
		description: "Building cool stuff",
		streamerId: "user-2",
		status: "preparing",
		createdAt: new Date(Date.now() - 1800000),
		endedAt: null,
	},
	{
		id: "room-3",
		name: "Music Live",
		description: null,
		streamerId: null,
		status: "waiting",
		createdAt: new Date(Date.now() - 900000),
		endedAt: null,
	},
	{
		id: "room-4",
		name: "Podcast Recording",
		description: "Tech talks",
		streamerId: "user-1",
		status: "ended",
		createdAt: new Date(Date.now() - 7200000),
		endedAt: new Date(Date.now() - 3600000),
	},
	{
		id: "room-5",
		name: "Art Stream",
		description: "Digital painting",
		streamerId: "user-3",
		status: "active",
		createdAt: new Date(Date.now() - 600000),
		endedAt: null,
	},
];

export async function insertTestRooms(db: any) {
	const { streamingRooms } = await import("../../src/db/schema");
	await db.insert(streamingRooms).values(testRooms);
}
