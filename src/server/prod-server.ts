/**
 * The production HTTP server's wiring (ADR 5), apart from `server.prod.ts` so a test can start
 * it: srvx serving the static assets and the app's fetch handler on one Node `http.Server`, the
 * client-IP rewrite in front of it, and the realtime endpoint on the same server.
 */
import { Server as HttpServer, type IncomingMessage } from "node:http";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import { CLIENT_IP_HEADER, createClientIpResolver, rewriteClientIpHeader } from "./client-ip.ts";
import { attachRealtime, type RealtimeOptions, type RealtimeServer } from "./realtime.ts";
import { hashedAssetCaching, securityHeaders, withPrivateCaching } from "./security-headers.ts";

/** How long `stop` lets requests in flight finish before closing their connections. */
const STOP_GRACE_MS = 5_000;

export interface ProdServerOptions {
  app: { fetch(request: Request): Response | Promise<Response> };
  /** The built client assets (`dist/client`). */
  clientDir: string;
  port: number;
  hostname: string;
  /** Peers whose `cf-connecting-ip` names the client (`TRUSTED_PROXY_IPS`). */
  trustedProxies: readonly string[];
  /** Passed to `attachRealtime`, besides `trustedProxies` and `closeUnknownUpgrades`. */
  realtime?: Omit<RealtimeOptions, "trustedProxies" | "closeUnknownUpgrades">;
}

/** The server, not yet listening (call `server.serve()`), its realtime endpoint, and `stop`. */
export function createProdServer(options: ProdServerOptions) {
  const server = serve({
    fetch: withPrivateCaching((request) => options.app.fetch(request)),
    // Security headers wrap everything, so they come first (ADR 9 addendum).
    middleware: [securityHeaders, hashedAssetCaching, staticMiddleware({ dir: options.clientDir })],
    port: options.port,
    hostname: options.hostname,
    manual: true,
    // `stop` below is the shutdown: srvx's own would close the listener on SIGTERM and nothing else.
    gracefulShutdown: false,
  });

  const httpServer = server.node?.server;
  if (!(httpServer instanceof HttpServer)) {
    throw new Error("Expected srvx to create a Node http.Server");
  }

  // Before srvx (and so Better Auth's rate limiter) reads any request, replace `cf-connecting-ip`
  // with the resolved client IP: Cloudflare's value only from a trusted proxy, else the socket
  // address (ADR 9: the app also listens on the LAN, where anyone could send the header).
  const resolveClientIp = createClientIpResolver(options.trustedProxies, {
    warn: (message) => console.warn(`[http] ${message}`),
  });
  httpServer.prependListener("request", (request: IncomingMessage) => {
    rewriteClientIpHeader(
      request,
      resolveClientIp(request.socket.remoteAddress, request.headers[CLIENT_IP_HEADER]),
    );
  });

  // Nothing else takes upgrades here, so refuse any that aren't for the realtime socket.
  const realtime: RealtimeServer = attachRealtime(httpServer, {
    ...options.realtime,
    trustedProxies: options.trustedProxies,
    closeUnknownUpgrades: true,
  });

  /**
   * Stop taking connections, close every realtime socket, and wait for requests in flight. What
   * is still open after `graceMs` is closed by force, so this can't hang on a stuck request.
   */
  async function stop(graceMs = STOP_GRACE_MS): Promise<void> {
    // Started first, not awaited: it finishes only once the sockets below are closed.
    const closing = server.close();
    const forced = setTimeout(() => void server.close(true), graceMs);
    try {
      await realtime.close();
      await closing;
    } finally {
      clearTimeout(forced);
    }
  }

  return { server, realtime, stop };
}
