/**
 * A throwaway Postgres container for the `*.docker.test.ts` suites (`pnpm test:migrate`): the
 * real server and the production driver (postgres-js), which PGlite can't stand in for. One
 * container per test file, one empty database per test.
 */
import { execFileSync } from "node:child_process";
import postgres from "postgres";

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export interface PostgresContainer {
  /** A new empty database in the container; resolves to its connection URL. */
  createDatabase(): Promise<string>;
  /** Stop the container (started with `--rm`, so it's removed with it). */
  stop(): Promise<void>;
}

/**
 * Start Postgres and wait until it takes connections. `label` names the container
 * (`bhayanakcast-<label>-test-pg-<pid>`), so two files running together don't clash. Pair with
 * `stop()` in `afterAll`; give `beforeAll` 120 s for the image pull and first boot.
 */
export async function startPostgresContainer(label: string): Promise<PostgresContainer> {
  const name = `bhayanakcast-${label}-test-pg-${process.pid}`;
  docker(
    ["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::5432"].concat([
      "-e",
      "POSTGRES_PASSWORD=test",
      "postgres:17-alpine",
    ]),
  );
  const port = docker(["port", name, "5432/tcp"]).trim().split("\n")[0]?.split(":").at(-1) ?? "";
  const urlFor = (database: string) => `postgres://postgres:test@127.0.0.1:${port}/${database}`;
  const admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
  try {
    for (let i = 0; ; i++) {
      try {
        await admin`select 1`;
        break;
      } catch (err) {
        if (i >= 60) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    await admin.end();
    docker(["rm", "-f", name]);
    throw err;
  }

  let databases = 0;
  return {
    async createDatabase() {
      const database = `test_${++databases}`;
      await admin.unsafe(`create database ${database}`);
      return urlFor(database);
    },
    async stop() {
      await admin.end();
      try {
        docker(["rm", "-f", name]);
      } catch {
        // Already gone.
      }
    },
  };
}
