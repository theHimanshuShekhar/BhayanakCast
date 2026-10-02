/**
 * Apply pending migrations from ./drizzle using Drizzle's runtime migrator, so
 * the production image doesn't need drizzle-kit. Run with `pnpm db:migrate`
 * (Node executes this .ts file natively). Safe to run from several instances
 * at once and refuses out-of-order migrations: see ./migrations.ts.
 */
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { databaseUrlProblem } from "./database-url.ts";
import { applyMigrations, MigrationOrderError } from "./migrations.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const problem = databaseUrlProblem(url);
if (problem) {
  console.error(`DATABASE_URL ${problem}`);
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
// Two connections: applyMigrations holds its advisory lock on one and migrates on the other.
const client = postgres(url, { max: 2, onnotice: () => {} });

try {
  await applyMigrations(client, migrationsFolder);
  console.log("Migrations applied");
} catch (err) {
  if (!(err instanceof MigrationOrderError)) throw err;
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
