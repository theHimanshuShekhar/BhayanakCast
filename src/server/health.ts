/**
 * Readiness for the app container's healthcheck (docs/deploy.md): `GET /api/health` is healthy only
 * while Postgres answers a `select 1`. Better Auth's `/api/auth/ok` never touches the database, so
 * an app whose database went away still passed it.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { shortCommit, startedAt } from "./build-info.ts";

/** Longer than a healthy `select 1`, and well under the compose healthcheck's 10 s timeout. */
export const HEALTH_DB_TIMEOUT_MS = 3_000;

/** Whether `db` answers `select 1` within `timeoutMs`. Never throws. */
export async function databaseReachable(
  db: Db,
  timeoutMs = HEALTH_DB_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const answered = Promise.resolve()
    .then(() => db.execute(sql`select 1`))
    .then(
      () => true,
      () => false,
    );
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 200 `{ok: true, commit, startedAt}` while the database answers, else 503 with `ok: false`.
 * `commit` is the running build's first 7 characters (`unknown` if the image couldn't fetch it)
 * and `startedAt` when the process started, so one curl confirms a deploy. Never cached.
 */
export async function healthResponse(db: Db, timeoutMs?: number): Promise<Response> {
  const ok = await databaseReachable(db, timeoutMs);
  return Response.json(
    { ok, commit: shortCommit(), startedAt: startedAt() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
