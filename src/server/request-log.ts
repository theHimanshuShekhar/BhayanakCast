/**
 * srvx middleware that gives every request a log context: the lines written while it is answered
 * (an error in a server function, a refused read) carry its `requestId` and `route`. First in the
 * chain (src/server/prod-server.ts). It writes nothing itself: successful requests aren't logged.
 */
import { randomBytes } from "node:crypto";
import type { ServerMiddleware } from "srvx";
import { routeOf, withRequestLog } from "./logger.ts";

/** Ids the proxy or a client may send: plain tokens, short. Anything else is replaced. */
const PLAIN_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The request's id: `x-request-id` if the proxy sent one, else Cloudflare's `cf-ray` (so a line
 * can be matched to Cloudflare's own log), else a random one.
 */
export function requestIdOf(headers: Headers): string {
  for (const name of ["x-request-id", "cf-ray"]) {
    const value = headers.get(name);
    if (value && PLAIN_ID.test(value)) return value;
  }
  return randomBytes(8).toString("hex");
}

export const requestLogging: ServerMiddleware = (request, next) =>
  withRequestLog({ requestId: requestIdOf(request.headers), route: routeOf(request.url) }, () =>
    next(),
  );
