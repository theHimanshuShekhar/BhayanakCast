/**
 * Resolve the Better Auth session for a raw request, e.g. a WebSocket upgrade
 * (ADR 7: the upgrade is authenticated with the same session cookie; reject it
 * when this returns null).
 */
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { type AuthSession, auth } from "../lib/auth.ts";

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

/** Returns the signed-in user's session, or null if absent, expired, or the user is banned. */
export async function getSessionFromRequest(source: HeaderSource): Promise<AuthSession | null> {
  const session = await auth.api.getSession({ headers: toHeaders(source) });
  if (!session || session.user.banned) return null;
  return session;
}
