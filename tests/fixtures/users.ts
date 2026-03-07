export const testUsers = [
	{
		id: "user-1",
		name: "Alice Smith",
		email: "alice@example.com",
		emailVerified: true,
		image: "https://example.com/alice.png",
		createdAt: new Date("2024-01-01"),
		updatedAt: new Date("2024-01-01"),
	},
	{
		id: "user-2",
		name: "Bob Johnson",
		email: "bob@example.com",
		emailVerified: true,
		image: null,
		createdAt: new Date("2024-01-02"),
		updatedAt: new Date("2024-01-02"),
	},
	{
		id: "user-3",
		name: "Carol Williams",
		email: "carol@example.com",
		emailVerified: false,
		image: "https://example.com/carol.png",
		createdAt: new Date("2024-01-03"),
		updatedAt: new Date("2024-01-03"),
	},
];

export async function insertTestUsers(db: any) {
	const { users } = await import("../../src/db/schema");
	await db.insert(users).values(testUsers);
}
