/**
 * In-process Postgres for tests: a fresh PGlite instance with the real
 * migrations from ./drizzle applied. No Docker or Postgres daemon needed.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client.ts";
import * as schema from "./schema/index.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
