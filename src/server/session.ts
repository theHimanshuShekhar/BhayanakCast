/**
 * Resolve the Better Auth session for a raw request, e.g. a WebSocket upgrade
 * (ADR 7: the upgrade is authenticated with the same session cookie; reject it
 * when this returns null).
 */
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { type AuthSession, auth } from "../lib/auth.ts";
import { isBanActive } from "../lib/ban.ts";

type HeaderSource = Request | IncomingMessage | IncomingHttpHeaders | Headers;

export function toHeaders(source: HeaderSource): Headers {
  if (source instanceof Headers) return source;
  if (typeof Request !== "undefined" && source instanceof Request) return source.headers;
  const raw: IncomingHttpHeaders =
    "headers" in source && typeof source.headers === "object"
      ? (source as IncomingMessage).headers
      : (source as IncomingHttpHeaders);
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

type Auth = Pick<typeof auth, "api">;

/**
 * The session for `headers` from `authInstance`, or null if absent, expired, or the
 * user is banned. A ban takes effect on the user's next request even though their
 * session row still exists; a ban whose expiry has passed no longer counts.
 */
export async function resolveSession(
  authInstance: Auth,
  headers: Headers,
): Promise<AuthSession | null> {
  const session = await authInstance.api.getSession({ headers });
  if (!session || isBanActive(session.user)) return null;
  return session;
}

/** Returns the signed-in user's session, or null if absent, expired, or the user is banned. */
export function getSessionFromRequest(source: HeaderSource): Promise<AuthSession | null> {
  return resolveSession(auth, toHeaders(source));
}
