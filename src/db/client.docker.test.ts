/**
 * `createDb`'s statement timeout against a real Postgres in a throwaway container: PGlite doesn't
 * enforce `statement_timeout` (a `pg_sleep` runs to the end). Needs Docker; `pnpm test:migrate`.
 */
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, STATEMENT_TIMEOUT_MS } from "./client.ts";

const pg = `bhayanakcast-client-test-pg-${process.pid}`;
let url: string;

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  docker(
    ["run", "-d", "--rm", "--name", pg, "-p", "127.0.0.1::5432"].concat([
      "-e",
      "POSTGRES_PASSWORD=test",
      "postgres:17-alpine",
    ]),
  );
  const port = docker(["port", pg, "5432/tcp"]).trim().split("\n")[0]?.split(":").at(-1) ?? "";
  url = `postgres://postgres:test@127.0.0.1:${port}/postgres`;
  for (let i = 0; ; i++) {
    const probe = createDb(url, { onnotice: () => {} });
    try {
      await probe.db.execute(sql`select 1`);
      await probe.close();
      break;
    } catch (err) {
      await probe.close();
      if (i >= 60) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}, 120_000);

afterAll(() => {
  try {
    docker(["rm", "-f", pg]);
  } catch {
    // Already gone.
  }
});

describe("createDb", () => {
  it("runs with the default statement timeout on every pooled connection", async () => {
    const { db, close } = createDb(url);
    try {
      const shown = await Promise.all(
        [1, 2, 3].map(() => db.execute(sql`select current_setting('statement_timeout') as t`)),
      );
      for (const rows of shown) {
        expect(rows[0]?.t).toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`);
      }
    } finally {
      await close();
    }
  });

  it("cancels a statement past the timeout and stays usable", async () => {
    const { db, close } = createDb(url, { connection: { statement_timeout: 300 } });
    try {
      const started = Date.now();
      // Drizzle wraps the driver's error; its `cause` carries the Postgres code.
      await expect(db.execute(sql`select pg_sleep(5)`)).rejects.toMatchObject({
        cause: { code: "57014" },
      });
      expect(Date.now() - started).toBeLessThan(3_000);
      expect((await db.execute(sql`select 1 as one`))[0]?.one).toBe(1);
    } finally {
      await close();
    }
  });
});
