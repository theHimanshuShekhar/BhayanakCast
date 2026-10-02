import { z } from "zod";

/**
 * Why `value` can't be used as a Postgres connection URL, or undefined when it can.
 *
 * Compose builds `DATABASE_URL` by pasting `POSTGRES_USER` and `POSTGRES_PASSWORD` into
 * `postgres://user:password@db:5432/name`. A password holding `/`, `#` or `?` doesn't always fail
 * to parse: it can parse into a different host, port or path and fail later with a baffling
 * connection error. So this checks the parts, not just that `new URL` accepts the string.
 */
export function databaseUrlProblem(value: string): string | undefined {
  const hint =
    "percent-encode special characters in the user and password, or use a URL-safe password " +
    "(`openssl rand -hex 24`)";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `must be a postgres:// URL; ${hint}`;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return "must start with postgres:// or postgresql://";
  }
  if (!url.hostname) return `has no host; ${hint}`;
  if (!/^\/[^/]+$/.test(url.pathname) || url.hash) {
    return `must end in exactly one database name; ${hint}`;
  }
  try {
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    return `has a "%" in the user or password that isn't a percent-escape; ${hint}`;
  }
  return undefined;
}

/** `DATABASE_URL`: a Postgres URL whose parts survived being composed from separate variables. */
export const databaseUrl = z.string().superRefine((value, ctx) => {
  const problem = databaseUrlProblem(value);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});
