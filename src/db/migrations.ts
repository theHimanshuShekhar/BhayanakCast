/**
 * Safe startup migrations: serialised across app instances, and refusing to silently skip.
 * Used by src/db/migrate.ts; the logic lives here so tests can import it.
 */
import fs from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";

/** Arbitrary but fixed: every runner of this app's migrations takes the same advisory lock. */
export const MIGRATION_LOCK_ID = 7_314_201_906_025;

export class MigrationOrderError extends Error {}

type JournalMigration = { tag: string; when: number; hash: string };
type AppliedMigration = { hash: string; createdAt: number };

/**
 * Journal entries Drizzle's migrator would silently skip, though they never ran.
 *
 * Drizzle compares only the newest applied `created_at` with each entry's `when` and runs the
 * entry when `created_at < when` (pg-core dialect `migrate`), so an entry whose `when` is not
 * newer than the newest applied one is skipped for good. It's "never ran" when no applied row has
 * its hash or its `when` (Drizzle stores `when` as `created_at`; matching it too keeps an
 * already-applied migration whose file was later reformatted from counting as unapplied).
 */
export function findSkippedMigrations(
  journal: readonly JournalMigration[],
  applied: readonly AppliedMigration[],
): JournalMigration[] {
  if (applied.length === 0) return [];
  const newest = Math.max(...applied.map((row) => row.createdAt));
  const hashes = new Set(applied.map((row) => row.hash));
  const times = new Set(applied.map((row) => row.createdAt));
  return journal.filter(
    (entry) => entry.when <= newest && !hashes.has(entry.hash) && !times.has(entry.when),
  );
}

async function readApplied(client: postgres.Sql): Promise<AppliedMigration[]> {
  // Drizzle's default table; it doesn't exist yet on a fresh database.
  const [found] = await client<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!found?.exists) return [];
  const rows = await client<{ hash: string; created_at: string }[]>`
    select hash, created_at from drizzle.__drizzle_migrations`;
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

export function readJournal(migrationsFolder: string): JournalMigration[] {
  const { entries } = JSON.parse(fs.readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8"));
  // readMigrationFiles returns one migration per journal entry, in journal order.
  const files = readMigrationFiles({ migrationsFolder });
  return files.map((file, i) => ({
    tag: entries[i].tag,
    when: file.folderMillis,
    hash: file.hash,
  }));
}

/**
 * Apply pending migrations from `migrationsFolder`.
 *
 * Runs under a Postgres advisory lock held on its own reserved connection, so instances starting
 * together take turns: the second one finds nothing left to apply. `client` therefore needs a
 * pool of at least 2 connections, one for the lock and one for the migration. Postgres drops the
 * lock with its connection, so a crashed runner can't leave it held.
 *
 * Throws `MigrationOrderError`, applying nothing, when a migration was added with a timestamp
 * older than one already applied: see `findSkippedMigrations`.
 */
export async function applyMigrations(client: postgres.Sql, migrationsFolder: string) {
  const lockConnection = await client.reserve();
  let locked = false;
  try {
    await lockConnection`select pg_advisory_lock(${MIGRATION_LOCK_ID}::bigint)`;
    locked = true;
    // Inside the lock: what's applied can change while waiting for it.
    const skipped = findSkippedMigrations(readJournal(migrationsFolder), await readApplied(client));
    if (skipped.length > 0) {
      throw new MigrationOrderError(
        `Refusing to migrate: ${skipped.map((entry) => entry.tag).join(", ")} ` +
          "is older than the newest applied migration but was never applied, so Drizzle would " +
          "skip it forever. Regenerate it with a newer timestamp (drizzle/meta/_journal.json " +
          '"when"): run `pnpm db:generate` again after rebasing onto the latest migrations.',
      );
    }
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    try {
      // Only if it was taken: a failed lock query mustn't be hidden by a failed unlock.
      if (locked) await lockConnection`select pg_advisory_unlock(${MIGRATION_LOCK_ID}::bigint)`;
    } finally {
      lockConnection.release();
    }
  }
}
