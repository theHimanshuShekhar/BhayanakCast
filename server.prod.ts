/**
 * Production server entry (ADR 0005). Serves the built client assets and the
 * TanStack Start SSR handler from one Node `http.Server`, so the realtime
 * WebSocket endpoint (ADR 0004) can attach to the same server.
 *
 * Run after `pnpm build` with `pnpm start` (Node runs this .ts file natively).
 */
import { Server as HttpServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import { getDb } from "./src/db/client.ts";
import {
  CLIENT_IP_HEADER,
  createClientIpResolver,
  rewriteClientIpHeader,
} from "./src/server/client-ip.ts";
import { env } from "./src/server/env.ts";
import { startMaintenance } from "./src/server/maintenance.ts";
import { attachRealtime } from "./src/server/realtime.ts";
import {
  hashedAssetCaching,
  securityHeaders,
  withPrivateCaching,
} from "./src/server/security-headers.ts";

type ServerEntry = { fetch(request: Request): Response | Promise<Response> };

const clientDir = fileURLToPath(new URL("./dist/client", import.meta.url));
const serverEntryUrl = new URL("./dist/server/server.js", import.meta.url).href;

const { default: app } = (await import(serverEntryUrl)) as { default: ServerEntry };

const server = serve({
  fetch: withPrivateCaching((request) => app.fetch(request)),
  // Security headers wrap everything, so they come first (ADR 9 addendum).
  middleware: [securityHeaders, hashedAssetCaching, staticMiddleware({ dir: clientDir })],
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? "0.0.0.0",
  manual: true,
});

const httpServer = server.node?.server;
if (!(httpServer instanceof HttpServer)) {
  throw new Error("Expected srvx to create a Node http.Server");
}

// Before srvx (and so Better Auth's rate limiter) reads any request, replace `cf-connecting-ip`
// with the resolved client IP: Cloudflare's value only from a trusted proxy, else the socket
// address (ADR 9: the app also listens on the LAN, where anyone could send the header).
const resolveClientIp = createClientIpResolver(env.TRUSTED_PROXY_IPS, {
  warn: (message) => console.warn(`[http] ${message}`),
});
httpServer.prependListener("request", (request: IncomingMessage) => {
  rewriteClientIpHeader(
    request,
    resolveClientIp(request.socket.remoteAddress, request.headers[CLIENT_IP_HEADER]),
  );
});

// Nothing else takes upgrades here, so refuse any that aren't for the realtime socket.
attachRealtime(httpServer, { closeUnknownUpgrades: true });

// Daily retention purge + stats roll-up (ADR 11).
startMaintenance(getDb());

await server.serve();
