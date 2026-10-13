/**
 * Resolve the Better Auth session for a raw request, e.g. a WebSocket upgrade
 * (ADR 7: the upgrade is authenticated with the same session cookie; reject it
 * when this returns null).
 */
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { toAdminRole } from "../lib/admin.ts";
import { type AuthSession, auth } from "../lib/auth.ts";
import { isBanActive } from "../lib/ban.ts";
import type { Caller } from "./caller.ts";
import { bindLogUser } from "./logger.ts";

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
export async function getSessionFromRequest(source: HeaderSource): Promise<AuthSession | null> {
  const session = await resolveSession(auth, toHeaders(source));
  // Lines the rest of this request writes (an error, a refused read) name the user.
  bindLogUser(session?.user.id);
  return session;
}

/** Who opened a socket, and with which session (null for a visitor). */
export interface Authenticated {
  caller: Caller;
  sessionId: string | null;
}

/** `callerFromSession`, with the session's id so the hub can close its sockets when it ends. */
export function authenticatedFromSession(
  session: Pick<AuthSession, "user" | "session"> | null,
): Authenticated {
  return { caller: callerFromSession(session), sessionId: session?.session.id ?? null };
}

/** The caller a resolved session (or its absence) stands for. */
export function callerFromSession(session: Pick<AuthSession, "user"> | null): Caller {
  if (!session) return { user: null, role: "visitor" };
  const { id, name, discordUsername, image, role } = session.user;
  return {
    user: { id, username: discordUsername ?? name, image: image ?? null },
    role: toAdminRole(role),
  };
}
