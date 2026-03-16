import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";

// Parse DATABASE_URL to extract connection components
function parseDatabaseUrl(url: string) {
	const match = url.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
	if (!match) {
		throw new Error("Invalid DATABASE_URL format");
	}
	const [, user, password, host, port, database] = match;
	return { user, password, host, port: parseInt(port), database };
}

// Get the main database URL from environment
const MAIN_DATABASE_URL = process.env.DATABASE_URL ||
	"postgresql://postgres:postgres@localhost:5432/postgres";

// Parse connection details
const { user, password, host, port } = parseDatabaseUrl(MAIN_DATABASE_URL);

// Create test database URL (same server, different database)
const TEST_DATABASE_NAME = "bhayanak_cast_test";
const TEST_DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${TEST_DATABASE_NAME}`;

// Admin connection URL (to create test database)
const ADMIN_DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/postgres`;

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let migrationsRun = false;

/**
 * Ensure test database exists
 */
async function ensureTestDatabaseExists(): Promise<void> {
	const adminPool = new Pool({
		connectionString: ADMIN_DATABASE_URL,
		max: 1,
	});

	try {
		// Check if test database exists
		const result = await adminPool.query(
			"SELECT 1 FROM pg_database WHERE datname = $1",
			[TEST_DATABASE_NAME]
		);

		if (result.rowCount === 0) {
			// Create test database
			console.log(`[Test DB] Creating test database: ${TEST_DATABASE_NAME}`);
			await adminPool.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
			console.log(`[Test DB] Test database created successfully`);
		} else {
			console.log(`[Test DB] Test database already exists: ${TEST_DATABASE_NAME}`);
		}
	} finally {
		await adminPool.end();
	}
}

/**
 * Run migrations on test database
 */
async function runMigrations(): Promise<void> {
	// Use drizzle-kit push to sync schema
	const { execSync } = require("child_process");
	try {
		execSync(
			`DATABASE_URL="${TEST_DATABASE_URL}" pnpm exec drizzle-kit push`,
			{ stdio: "inherit" }
		);
		console.log("[Test DB] Schema synced successfully");
	} catch (error) {
		console.error("[Test DB] Failed to sync schema:", error);
		throw error;
	}
}

export async function getTestDatabase() {
	if (!pool) {
		// Ensure test database exists
		await ensureTestDatabaseExists();

		// Create connection pool for test database
		pool = new Pool({
			connectionString: TEST_DATABASE_URL,
			max: 10,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});
		db = drizzle(pool, { schema });

		// Run migrations if not already run
		if (!migrationsRun) {
			await runMigrations();
			migrationsRun = true;
		}
	}
	return { pool, db: db! };
}

export async function setupTestDatabase() {
	// Ensure database exists and has schema
	await ensureTestDatabaseExists();
	await runMigrations();

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

	// Also clear community stats so tests get fresh calculations
	await db.delete(schema.communityStatsSnapshots);
}

// Note: We're not using transactions anymore since server functions
// create their own database connections. Instead, we clear tables
// before each test and let the data be committed.
