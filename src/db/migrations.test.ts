import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { findSkippedMigrations, readJournal } from "./migrations.ts";

const entry = (tag: string, when: number) => ({ tag, when, hash: `hash-${tag}` });
const applied = (...entries: { when: number; hash: string }[]) =>
  entries.map((e) => ({ hash: e.hash, createdAt: e.when }));

const a = entry("0000_a", 1000);
const b = entry("0001_b", 2000);
const c = entry("0002_c", 3000);

describe("findSkippedMigrations", () => {
  it("finds nothing on a fresh database or when everything is applied", () => {
    expect(findSkippedMigrations([a, b, c], [])).toEqual([]);
    expect(findSkippedMigrations([a, b, c], applied(a, b, c))).toEqual([]);
  });

  it("finds nothing when the unapplied entries are all newer than the newest applied", () => {
    expect(findSkippedMigrations([a, b, c], applied(a))).toEqual([]);
    expect(findSkippedMigrations([a, b, c], applied(a, b))).toEqual([]);
  });

  it("finds an unapplied entry older than the newest applied one", () => {
    // b was added on a branch with an older timestamp than c, which already ran.
    expect(findSkippedMigrations([a, b, c], applied(a, c))).toEqual([b]);
  });

  it("doesn't count an applied entry whose file changed since, matched by its timestamp", () => {
    const reformatted = { ...b, hash: "hash-after-reformat" };
    expect(findSkippedMigrations([a, reformatted, c], applied(a, b, c))).toEqual([]);
  });

  it("lists every skipped entry", () => {
    expect(findSkippedMigrations([a, b, c], applied(c))).toEqual([a, b]);
  });
});

describe("readJournal", () => {
  // Boots PGlite and migrates inside the test, so it needs more than vitest's 5 s under load.
  it("agrees with the rows Drizzle's own migrator records, so a migrated database is clean", {
    timeout: 30_000,
  }, async () => {
    const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
    const client = new PGlite();
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
      const { rows } = await client.query<{ hash: string; created_at: string }>(
        "select hash, created_at from drizzle.__drizzle_migrations",
      );
      const journal = readJournal(migrationsFolder);
      expect(rows).toHaveLength(journal.length);
      expect(journal.map((m) => m.tag)[0]).toMatch(/^0000_/);
      const rowsApplied = rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
      expect(findSkippedMigrations(journal, rowsApplied)).toEqual([]);
      // Drop a middle row: Drizzle would skip it (older than the newest), and so do we.
      const middle = rowsApplied.filter((_, i) => i !== 1);
      expect(findSkippedMigrations(journal, middle).map((m) => m.tag)).toEqual([journal[1]?.tag]);
    } finally {
      await client.close();
    }
  });
});
