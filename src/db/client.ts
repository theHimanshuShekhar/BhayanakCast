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

/**
 * Longest one statement may run before Postgres cancels it (ADR 8 addendum). The realtime hub
 * runs every operation on one serial queue, so a hung query would freeze heartbeats and every
 * room until clients timed out; the app's statements are indexed lookups and small writes that
 * finish in milliseconds, so 10 seconds only ever cuts off one that is stuck.
 */
export const STATEMENT_TIMEOUT_MS = 10_000;

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, {
    max: 10,
    ...options,
    // Sent in the startup message, so it covers every pooled connection.
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS, ...options.connection },
  });
  const db = drizzle({ client, schema });
  return { db, close: () => client.end() };
}

let cached: ReturnType<typeof createDb> | undefined;

// A process global, not a module variable: the built SSR bundle and
// server.prod.ts each load their own copy of this module.
const PROVIDED_DB = Symbol.for("bhayanakcast.providedDb");
const registry = globalThis as { [PROVIDED_DB]?: Db };

/**
 * Serve every `getDb()` in this process from `db` instead of DATABASE_URL.
 * For the e2e server only (e2e/serve.ts runs the prod build on PGlite).
 */
export function provideDb(db: Db): void {
  if (env.NODE_ENV === "production") throw new Error("provideDb is not allowed in production");
  registry[PROVIDED_DB] = db;
}

/** Process-wide database: the provided one, else a pool created on first use from DATABASE_URL. */
export function getDb(): Db {
  const provided = registry[PROVIDED_DB];
  if (provided) return provided;
  if (!cached) {
    cached = createDb(env.DATABASE_URL);
  }
  return cached.db;
}
