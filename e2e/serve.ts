/**
 * E2E server: the real production server (`server.prod.ts`) against a
 * throwaway in-process PGlite, migrated like the unit-test DB, so e2e needs no
 * Postgres. Every `getDb()` in the process (SSR bundle and server.prod.ts
 * alike) shares this one database. Run after `pnpm build`.
 */
import { provideDb } from "../src/db/client.ts";
import { createTestDb } from "../src/db/test-db.ts";

const { db } = await createTestDb();
provideDb(db);
await import("../server.prod.ts");
