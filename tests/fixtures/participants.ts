export const testParticipants = [
	{
		id: "part-1",
		roomId: "room-1",
		userId: "user-1",
		joinedAt: new Date(Date.now() - 3600000),
		leftAt: null,
		totalTimeSeconds: 3600,
	},
	{
		id: "part-2",
		roomId: "room-1",
		userId: "user-2",
		joinedAt: new Date(Date.now() - 3000000),
		leftAt: null,
		totalTimeSeconds: 3000,
	},
	{
		id: "part-3",
		roomId: "room-1",
		userId: "user-3",
		joinedAt: new Date(Date.now() - 2400000),
		leftAt: null,
		totalTimeSeconds: 2400,
	},
	{
		id: "part-4",
		roomId: "room-2",
		userId: "user-2",
		joinedAt: new Date(Date.now() - 1800000),
		leftAt: null,
		totalTimeSeconds: 1800,
	},
	{
		id: "part-5",
		roomId: "room-5",
		userId: "user-3",
		joinedAt: new Date(Date.now() - 600000),
		leftAt: null,
		totalTimeSeconds: 600,
	},
	{
		id: "part-6",
		roomId: "room-5",
		userId: "user-1",
		joinedAt: new Date(Date.now() - 300000),
		leftAt: null,
		totalTimeSeconds: 300,
	},
];

export async function insertTestParticipants(db: any) {
	const { roomParticipants } = await import("../../src/db/schema");
	await db.insert(roomParticipants).values(testParticipants);
}
