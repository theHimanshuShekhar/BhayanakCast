/**
 * Which build is running: the git commit and when the process started. The commit is on every log
 * line and in `/api/health`, so a deploy can be confirmed and a log line tied to its code.
 *
 * The Dockerfile bakes the commit into `COMMIT` beside the app (scripts/fetch-commit.ts), because
 * Dockhand copies the repo without `.git`. `GIT_COMMIT` stands in for it outside the image.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UNKNOWN = "unknown";
const COMMIT_HASH = /^[0-9a-f]{7,40}$/i;

/** The commit `env.GIT_COMMIT` or `<appDir>/COMMIT` names, or `unknown`. */
export function readCommit(
  env: { GIT_COMMIT?: string } = process.env,
  appDir: string = process.cwd(),
): string {
  let candidate = env.GIT_COMMIT?.trim();
  if (!candidate) {
    try {
      candidate = readFileSync(join(appDir, "COMMIT"), "utf8").trim();
    } catch {
      return UNKNOWN;
    }
  }
  return COMMIT_HASH.test(candidate) ? candidate : UNKNOWN;
}

let commit: string | undefined;

/** The running commit, read once. */
export function getCommit(): string {
  commit ??= readCommit();
  return commit;
}

/** `commit` as 7 characters, the form `/api/health` shows. */
export function shortCommit(value: string = getCommit()): string {
  return value === UNKNOWN ? value : value.slice(0, 7);
}

/** When the process started (ISO, UTC). Process-wide, so the SSR bundle and server.prod.ts agree. */
export function startedAt(): string {
  return new Date(performance.timeOrigin).toISOString();
}
