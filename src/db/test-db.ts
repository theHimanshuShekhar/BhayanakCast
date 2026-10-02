/**
 * In-process Postgres for tests: a fresh PGlite instance with the real
 * migrations from ./drizzle applied. No Docker or Postgres daemon needed.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client.ts";
import * as schema from "./schema/index.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  // Migration 0007 creates `pg_trgm`, which PGlite only has when it is loaded here.
  const client = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
