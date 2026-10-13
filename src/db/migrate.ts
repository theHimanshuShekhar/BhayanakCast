/**
 * Apply pending migrations from ./drizzle using Drizzle's runtime migrator, so
 * the production image doesn't need drizzle-kit. Run with `pnpm db:migrate`
 * (Node executes this .ts file natively). Safe to run from several instances
 * at once and refuses out-of-order migrations: see ./migrations.ts.
 *
 * Importing ../server/env.ts validates the whole server environment, the same check the server
 * makes, and throws on a bad one. So a deploy with a missing secret stops here, before it changes
 * the schema, not after. Run it locally with NODE_ENV=development to need only DATABASE_URL.
 *
 * It logs through the server's logger (`migrate.applied`, `migrate.refused`), so the line carries
 * the commit and reaches VictoriaLogs like the rest.
 */
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { env } from "../server/env.ts";
import { log } from "../server/logger.ts";
import { applyMigrations, MigrationOrderError } from "./migrations.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
// Two connections: applyMigrations holds its advisory lock on one and migrates on the other.
const client = postgres(env.DATABASE_URL, { max: 2, onnotice: () => {} });

try {
  await applyMigrations(client, migrationsFolder);
  log.info("migrate.applied", "Migrations applied");
} catch (err) {
  if (!(err instanceof MigrationOrderError)) throw err;
  log.error("migrate.refused", err.message, { err });
  process.exitCode = 1;
} finally {
  await client.end();
}
