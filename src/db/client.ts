import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../server/env.ts";
import * as schema from "./schema/index.ts";

export { schema };

/**
 * Driver-agnostic database handle. Production uses postgres-js; tests use
 * PGlite. Code that only needs to run queries should accept this type.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, { max: 10, ...options });
  const db = drizzle({ client, schema });
  return { db, close: () => client.end() };
}

let cached: ReturnType<typeof createDb> | undefined;

/** Process-wide connection pool, created on first use from DATABASE_URL. */
export function getDb() {
  if (!cached) {
    cached = createDb(env.DATABASE_URL);
  }
  return cached.db;
}
