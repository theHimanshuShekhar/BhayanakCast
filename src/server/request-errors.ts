/**
 * Errors out of a server function or an HTTP route, as log lines with the route and the user
 * (src/start.ts wires these to every server function and request). A request that succeeds writes
 * nothing; only a throw does.
 *
 * - `server_fn.failed` / `http.unhandled` (error): something unexpected threw. It needs fixing.
 * - `server_fn.refused` (warn): the app's own refusals, thrown on purpose (not signed in, not an
 *   admin, over the read limit, a bad input), as the client caused them.
 *
 * An error is written once: the code that threw it may have logged it already with more context
 * (`wasLogged`), and a catch further out then adds nothing.
 */
import { type LogFields, log, routeOf, wasLogged } from "./logger.ts";

/** Errors the server throws on purpose to refuse a caller, by class name (modules load twice). */
const REFUSALS: ReadonlySet<string> = new Set([
  "SignInRequiredError",
  "AdminRequiredError",
  "BanAdminError",
  "RoleChangeError",
  "SelfFavoriteError",
  "NotStreamingError",
  "InvalidThumbnailError",
  "ZodError",
]);

/**
 * Start fails a call whose input didn't validate with a plain `Error` whose message is the
 * validator's issues as JSON (an array of `{code, path, ...}`): the client's doing, not a bug.
 */
function isValidationFailure(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message.startsWith("[")) return false;
  try {
    const issues: unknown = JSON.parse(error.message);
    return (
      Array.isArray(issues) &&
      issues.length > 0 &&
      issues.every(
        (issue) =>
          typeof issue === "object" && issue !== null && "code" in issue && "path" in issue,
      )
    );
  } catch {
    return false;
  }
}

/** A `redirect()` (a `Response`) or `notFound()` the router throws to steer, not to fail. */
function isControlFlow(error: unknown): boolean {
  if (error instanceof Response) return true;
  return typeof error === "object" && error !== null && "isNotFound" in error;
}

/** A server function threw `error`. `userId` is the caller, if they are signed in. */
export function logServerFnError(
  error: unknown,
  fn: { name: string; userId?: string } & Pick<LogFields, "sampleKey">,
): void {
  if (isControlFlow(error) || wasLogged(error)) return;
  // `read.rate_limited` has said so already, with the kind of read.
  if (error instanceof Error && error.name === "ReadRateLimitedError") return;
  const { name, userId, sampleKey } = fn;
  const fields: LogFields = { serverFn: name, userId, sampleKey: sampleKey ?? userId, err: error };
  if (isValidationFailure(error)) {
    log.warn("server_fn.refused", `${name} refused: its input didn't validate`, fields);
  } else if (error instanceof Error && REFUSALS.has(error.name)) {
    log.warn("server_fn.refused", `${name} refused: ${error.message}`, fields);
  } else {
    log.error("server_fn.failed", `${name} threw`, fields);
  }
}

/** A route (a page, an API handler) threw `error` while answering `url`. */
export function logRouteError(error: unknown, url: string, userId?: string): void {
  if (isControlFlow(error) || wasLogged(error)) return;
  log.error("http.unhandled", "an unhandled error in a request", {
    route: routeOf(url),
    userId,
    err: error,
  });
}
