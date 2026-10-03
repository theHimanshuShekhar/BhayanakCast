/**
 * The caller of the current server-function request, from its session cookie, and the limit on
 * public reads by its client IP. Server-only: call them inside `createServerFn` handlers.
 */
import {
  getRequestHeader,
  getRequestHeaders,
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import type { Caller } from "./caller.ts";
import { CLIENT_IP_HEADER } from "./client-ip.ts";
import { env } from "./env.ts";
import {
  createReadLimiter,
  PUBLIC_READ_WINDOW_MS,
  type PublicRead,
  ReadRateLimitedError,
} from "./read-limit.ts";
import { callerFromSession, getSessionFromRequest } from "./session.ts";

export async function getCaller(): Promise<Caller> {
  return callerFromSession(await getSessionFromRequest(getRequestHeaders()));
}

const readLimiter = createReadLimiter(env.PUBLIC_READ_LIMIT_SCALE);

/**
 * Count a public `kind` read against the request's client IP and refuse it (HTTP 429 with
 * `Retry-After`, error `ReadRateLimitedError`) when over the limit. server.prod.ts rewrites
 * `cf-connecting-ip` to the resolved client IP before any handler runs (ADR 9); without it
 * (`pnpm dev`) every request counts as one client.
 */
export function limitPublicRead(kind: PublicRead): void {
  const ip = getRequestHeader(CLIENT_IP_HEADER)?.trim() || "unknown";
  if (readLimiter.allow(kind, ip, new Date())) return;
  setResponseStatus(429);
  setResponseHeader("retry-after", String(PUBLIC_READ_WINDOW_MS / 1000));
  throw new ReadRateLimitedError();
}

/**
 * `limitPublicRead` for an API route, which has the `Request` itself: whether its client IP may
 * do a `kind` read now. The route answers 429 when not.
 */
export function allowPublicRead(request: Request, kind: PublicRead): boolean {
  const ip = request.headers.get(CLIENT_IP_HEADER)?.trim() || "unknown";
  return readLimiter.allow(kind, ip, new Date());
}
