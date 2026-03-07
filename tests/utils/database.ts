import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";

const TEST_DATABASE_URL =
	"postgresql://postgres:postgres@localhost:5432/bhayanak_cast_test";

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export async function getTestDatabase() {
	if (!pool) {
		pool = new Pool({
			connectionString: TEST_DATABASE_URL,
			max: 10,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});
		db = drizzle(pool, { schema });
	}
	return { pool, db: db! };
}

export async function setupTestDatabase() {
	const { db } = await getTestDatabase();
	return { db };
}

export async function teardownTestDatabase() {
	if (pool) {
		await pool.end();
		pool = null;
		db = null;
	}
}

export async function clearTables() {
	const { db } = await getTestDatabase();

	// Delete in reverse order to avoid FK constraints
	await db.delete(schema.userRoomOverlaps);
	await db.delete(schema.userRelationships);
	await db.delete(schema.roomParticipants);
	await db.delete(schema.streamingRooms);
	await db.delete(schema.accounts);
	await db.delete(schema.sessions);
	await db.delete(schema.verifications);
	await db.delete(schema.users);
}

// Note: We're not using transactions anymore since server functions
// create their own database connections. Instead, we clear tables
// before each test and let the data be committed.
