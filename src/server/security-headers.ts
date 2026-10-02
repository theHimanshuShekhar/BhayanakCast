/**
 * Security headers and caching for the production server (ADR 9 addendum), wired in
 * server.prod.ts:
 *
 * - `securityHeaders` wraps every response, static assets included: a Content-Security-Policy
 *   with a fresh nonce per request, `nosniff` and a Referrer-Policy. The nonce goes to the app
 *   in `request.context`, so TanStack Start puts it on the inline scripts it renders for
 *   hydration and streaming (their content is per request, so hashes can't cover them).
 * - `hashedAssetCaching` gives the hashed bundles a year-long cache.
 * - `withPrivateCaching` wraps the app's own handler: what it answers depends on the caller
 *   (session cookie), so a shared cache must not keep it.
 */
import { randomBytes } from "node:crypto";
import type { ServerMiddleware } from "srvx";
import { CSP_NONCE_KEY } from "../lib/csp-nonce.ts";

/** Discord serves avatars from here (ADR 7); the UI loads pictures only from it. */
const DISCORD_CDN = "https://cdn.discordapp.com";

/**
 * Scripts: own bundles and the nonced inline ones, no `unsafe-inline`. Styles allow
 * `unsafe-inline` because React writes inline `style` attributes (and nothing here executes
 * through CSS). Media and images take no `blob:`: video plays MediaStreams through `srcObject`,
 * which CSP doesn't check, and thumbnails come from `/api/thumbnails`. WebRTC traffic (STUN/TURN)
 * isn't governed by `connect-src`; the socket and fetches are same-origin. Discord sign-in is a
 * navigation, which none of these restrict, and the page posts no form cross-origin.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${DISCORD_CDN}`,
    "media-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Invite pages (`/join/<token>`) have a bearer token in the URL: never send it as a Referer. */
function referrerPolicy(pathname: string): string {
  return pathname.startsWith("/join/") ? "no-referrer" : "strict-origin-when-cross-origin";
}

/** Set headers on `response`, on a copy if its own headers are read-only (`Response.redirect`). */
function setHeaders(response: Response, headers: Record<string, string>): Response {
  const set = (target: Response) => {
    for (const [name, value] of Object.entries(headers)) target.headers.set(name, value);
    return target;
  };
  try {
    return set(response);
  } catch {
    return set(new Response(response.body, response));
  }
}

/**
 * srvx middleware: a nonce for the app, then the security headers on whatever answers, a 500
 * for an unhandled error included (so it is answered here, not left to srvx's bare one).
 */
export const securityHeaders: ServerMiddleware = async (request, next) => {
  const nonce = randomBytes(16).toString("base64");
  request.context = { ...request.context, [CSP_NONCE_KEY]: nonce };
  let response: Response;
  try {
    response = await next();
  } catch (error) {
    console.error("[http] unhandled error", error);
    response = new Response("Internal Server Error", {
      status: 500,
      headers: { "content-type": "text/plain", "cache-control": "private, no-store" },
    });
  }
  return setHeaders(response, {
    "content-security-policy": contentSecurityPolicy(nonce),
    "x-content-type-options": "nosniff",
    "referrer-policy": referrerPolicy(new URL(request.url).pathname),
  });
};

/**
 * srvx middleware: Vite's content-hashed bundles in `/assets/` never change under their name, so
 * they cache for a year (the static middleware sends no Cache-Control). Everything else static,
 * like the favicon, keeps its default.
 */
export const hashedAssetCaching: ServerMiddleware = async (request, next) => {
  const response = await next();
  // Only what the static middleware sent: the app's answers always carry a Cache-Control.
  const served = (response.ok || response.status === 304) && !response.headers.has("cache-control");
  if (!served || !new URL(request.url).pathname.startsWith("/assets/")) return response;
  return setHeaders(response, { "cache-control": "public, max-age=31536000, immutable" });
};

/** Responses that are always for the one caller, whatever else the handler said about caching. */
const PRIVATE_PATHS = ["/_serverFn/", "/api/auth/"];

/**
 * `Cache-Control: private, no-store` on what the app answers: server functions, `/api/auth/*`
 * and HTML pages (they embed the session's loader data) always; any other response that
 * doesn't say otherwise (the thumbnails send `private` with an ETag, and keep it).
 */
export function withPrivateCaching(
  handler: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    const { pathname } = new URL(request.url);
    const isHtml = response.headers.get("content-type")?.startsWith("text/html") ?? false;
    const alwaysPrivate = isHtml || PRIVATE_PATHS.some((prefix) => pathname.startsWith(prefix));
    if (!alwaysPrivate && response.headers.has("cache-control")) return response;
    return setHeaders(response, { "cache-control": "private, no-store" });
  };
}
