/**
 * Better Auth's errors and sign-in failures as log lines, wired in src/lib/auth.ts as its `logger`
 * and `onAPIError`. Without these its failures (a Discord callback that didn't validate, a banned
 * user turned away, a server error) went to its own console format or nowhere.
 *
 * - `auth.log` (error or warn): a line Better Auth wrote itself, e.g. `Failed to parse state` on a
 *   sign-in callback. Only the message and the error it was given are kept: its other arguments
 *   can hold the OAuth state, tokens or the Discord profile.
 * - `auth.api_refused` (warn): an endpoint refused a caller (4xx), e.g. `BANNED_USER` at sign-in.
 * - `auth.api_error` (error): an endpoint threw something unexpected, or answered 5xx.
 */
import { log } from "./logger.ts";

type AuthLevel = "debug" | "info" | "warn" | "error";

/** Better Auth's `logger.log`. `debug` and `info` are left out: they are its own tracing. */
export function logAuthMessage(level: AuthLevel, message: string, args: readonly unknown[]): void {
  if (level !== "warn" && level !== "error") return;
  const err = args.find((arg) => arg instanceof Error);
  const code = (err as { code?: unknown } | undefined)?.code;
  log[level]("auth.log", message || "Better Auth reported an error", {
    code: typeof code === "string" ? code : undefined,
    err,
  });
}

interface ApiErrorLike {
  statusCode?: unknown;
  status?: unknown;
  message?: unknown;
  body?: { code?: unknown; message?: unknown };
}

/** Better Auth's `onAPIError.onError`. It replaces Better Auth's own handling, so it logs both kinds. */
export function logAuthApiError(error: unknown): void {
  const apiError: ApiErrorLike =
    typeof error === "object" && error !== null ? (error as ApiErrorLike) : {};
  // Its own redirects (the OAuth callback finishing) are not failures.
  if (apiError.status === "FOUND") return;
  const status = typeof apiError.statusCode === "number" ? apiError.statusCode : undefined;
  const code = typeof apiError.body?.code === "string" ? apiError.body.code : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    const message = typeof apiError.body?.message === "string" ? apiError.body.message : undefined;
    log.warn("auth.api_refused", message ?? String(apiError.message ?? "refused"), {
      status,
      code,
    });
    return;
  }
  log.error("auth.api_error", "a Better Auth endpoint failed", { status, code, err: error });
}
