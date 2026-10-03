/**
 * The migration runner against a real Postgres in a throwaway container: PGlite is one session, so
 * it can't hold a lock against a second runner. Needs Docker; `pnpm test:migrate`. Each test gets
 * its own empty database in the one container.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type PostgresContainer, startPostgresContainer } from "./docker-postgres.ts";
import {
  applyMigrations,
  MIGRATION_LOCK_ID,
  MigrationOrderError,
  readJournal,
} from "./migrations.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const realMigrations = path.join(repoRoot, "drizzle");
const journalLength = readJournal(realMigrations).length;

/** A Drizzle migrations folder holding `migrations` in journal order. */
function writeMigrations(migrations: { tag: string; when: number; sql: string }[]): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bhayanakcast-migrations-"));
  fs.mkdirSync(path.join(folder, "meta"));
  for (const { tag, sql } of migrations) fs.writeFileSync(path.join(folder, `${tag}.sql`), sql);
  const entries = migrations.map(({ tag, when }, idx) => ({
    idx,
    version: "7",
    when,
    tag,
    breakpoints: true,
  }));
  fs.writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
  return folder;
}

/** Run `node src/db/migrate.ts` the way the container does (`env` adds to Vitest's NODE_ENV=test). */
async function runMigrateScript(databaseUrl: string, env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["src/db/migrate.ts"], {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const { code, stdout, stderr } = err as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

let container: PostgresContainer;
let dbUrl: string;
let client: postgres.Sql;
const folders: string[] = [];

beforeAll(async () => {
  container = await startPostgresContainer("migrate");
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

beforeEach(async () => {
  dbUrl = await container.createDatabase();
  client = postgres(dbUrl, { max: 3, onnotice: () => {} });
});

afterEach(async () => {
  await client.end();
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

async function tableExists(name: string): Promise<boolean> {
  const [row] = await client`select to_regclass(${name}) is not null as found`;
  return row?.found;
}

/**
 * Whether another session could take the lock now. Asked from a fresh connection: the lock is
 * re-entrant within a session, so one of `client`'s own could say yes while it's still held.
 */
async function lockIsFree(): Promise<boolean> {
  const probe = postgres(dbUrl, { max: 1 });
  try {
    const [row] = await probe`select pg_try_advisory_lock(${MIGRATION_LOCK_ID}::bigint) as free`;
    return row?.free;
  } finally {
    await probe.end();
  }
}

const appliedCount = async () =>
  Number((await client`select count(*) from drizzle.__drizzle_migrations`)[0]?.count);

describe("advisory lock", () => {
  it("makes a runner wait while another holds the lock, then run", async () => {
    const holder = postgres(dbUrl, { max: 1 });
    try {
      await holder`select pg_advisory_lock(${MIGRATION_LOCK_ID}::bigint)`;
      const run = applyMigrations(client, realMigrations);
      const state = await Promise.race([
        run.then(() => "finished"),
        new Promise((resolve) => setTimeout(resolve, 1500, "waiting")),
      ]);
      expect(state).toBe("waiting");
      // It touched nothing while waiting: no migrations table yet.
      expect(await tableExists("drizzle.__drizzle_migrations")).toBe(false);

      await holder`select pg_advisory_unlock(${MIGRATION_LOCK_ID}::bigint)`;
      await run;
      expect(await appliedCount()).toBe(journalLength);
    } finally {
      await holder.end();
    }
  });

  it("lets two runners start together: both succeed and each migration is applied once", async () => {
    const [first, second] = await Promise.all([runMigrateScript(dbUrl), runMigrateScript(dbUrl)]);
    expect(first).toMatchObject({ code: 0, stderr: "" });
    expect(second).toMatchObject({ code: 0, stderr: "" });
    expect(await appliedCount()).toBe(journalLength);
  });

  it("releases the lock when the migration fails", async () => {
    const folder = writeMigrations([{ tag: "0000_bad", when: 1000, sql: "select * from nope" }]);
    folders.push(folder);
    await expect(applyMigrations(client, folder)).rejects.toThrow(/nope/);
    expect(await lockIsFree()).toBe(true);
  });
});

describe("migration order", () => {
  it("refuses a migration older than the newest applied one, and applies nothing", async () => {
    const first = { tag: "0000_a", when: 1000, sql: "create table a (id int);" };
    const third = { tag: "0002_c", when: 3000, sql: "create table c (id int);" };
    const late = { tag: "0001_b", when: 2000, sql: "create table b (id int);" };
    const before = writeMigrations([first, third]);
    const after = writeMigrations([first, late, third]);
    folders.push(before, after);

    await applyMigrations(client, before);
    await expect(applyMigrations(client, after)).rejects.toThrow(MigrationOrderError);
    await expect(applyMigrations(client, after)).rejects.toThrow(/0001_b/);

    expect(await appliedCount()).toBe(2);
    expect(await tableExists("public.b")).toBe(false);
    // The check ran inside the lock, so it must have released it.
    expect(await lockIsFree()).toBe(true);
  });

  it("is exited non-zero by the startup script with the reason on stderr", async () => {
    // Applied: the real migrations, plus one dated far in the future so every real one is "older".
    await applyMigrations(client, realMigrations);
    await client`insert into drizzle.__drizzle_migrations (hash, created_at)
      values ('future', ${Date.now() * 2})`;
    await client`delete from drizzle.__drizzle_migrations where created_at = (
      select min(created_at) from drizzle.__drizzle_migrations)`;

    const run = await runMigrateScript(dbUrl);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/Refusing to migrate: 0000_/);
    expect(run.stdout).not.toContain("Migrations applied");
  });
});

describe("startup script", () => {
  it("refuses an unusable DATABASE_URL by saying what to do", async () => {
    const run = await runMigrateScript("postgres://bhayanakcast:pa/ss@db:5432/bhayanakcast");
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/DATABASE_URL: .*percent-encode/);
  });

  it("validates the whole environment before it touches the database", async () => {
    // A production environment missing its secrets, against a database that is up: nothing may
    // be migrated, or a bad deploy would change the schema and then refuse to start.
    const run = await runMigrateScript(dbUrl, {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "",
      TRUSTED_PROXY_IPS: "",
    });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/Invalid environment configuration/);
    expect(run.stderr).toMatch(/BETTER_AUTH_SECRET/);
    expect(run.stdout).not.toContain("Migrations applied");
    expect(await tableExists("drizzle.__drizzle_migrations")).toBe(false);
  });
});

// Needs `pnpm build` (server.prod.ts serves dist/); CI builds before this suite.
describe.skipIf(!fs.existsSync(path.join(repoRoot, "dist/server/server.js")))(
  "production server",
  () => {
    it("exits by itself, with code 0, soon after SIGTERM", async () => {
      await applyMigrations(client, realMigrations);
      // The env schema wants a real port (not 0), so ask the OS for a free one.
      const probe = net.createServer();
      await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const freePort = (probe.address() as net.AddressInfo).port;
      await new Promise((resolve) => probe.close(resolve));
      const server = spawn(process.execPath, ["server.prod.ts"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          PORT: String(freePort),
          DATABASE_URL: dbUrl,
          BETTER_AUTH_URL: "http://localhost:3000",
          BETTER_AUTH_SECRET: "migrate-test-secret-0123456789abcdef",
          DISCORD_CLIENT_ID: "id",
          DISCORD_CLIENT_SECRET: "secret",
          TRUSTED_PROXY_IPS: "127.0.0.1",
        },
      });
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += chunk;
      });
      server.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
        server.once("exit", (code, signal) => resolve({ code, signal })),
      );
      try {
        // The pool is open by then: the maintenance pass queries the database on boot.
        await vi.waitFor(() => expect(output).toMatch(/\[maintenance\] sessions/), {
          timeout: 30_000,
        });
        const sent = Date.now();
        server.kill("SIGTERM");
        const result = await Promise.race([
          exited,
          new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 10_000)),
        ]);
        // 10 s is Docker's grace before SIGKILL.
        expect(result, output).not.toBe("hung");
        expect(result, output).toEqual({ code: 0, signal: null });
        expect(Date.now() - sent).toBeLessThan(10_000);
      } finally {
        server.kill("SIGKILL");
      }
    });
  },
);
