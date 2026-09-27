/**
 * Production server entry (ADR 0005). Serves the built client assets and the
 * TanStack Start SSR handler from one Node `http.Server`, so the realtime
 * WebSocket endpoint (ADR 0004) can attach to the same server.
 *
 * Run after `pnpm build` with `pnpm start` (Node runs this .ts file natively).
 */
import { Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import { attachRealtime } from "./src/server/realtime.ts";

type ServerEntry = { fetch(request: Request): Response | Promise<Response> };

const clientDir = fileURLToPath(new URL("./dist/client", import.meta.url));
const serverEntryUrl = new URL("./dist/server/server.js", import.meta.url).href;

const { default: app } = (await import(serverEntryUrl)) as { default: ServerEntry };

const server = serve({
  fetch: (request) => app.fetch(request),
  middleware: [staticMiddleware({ dir: clientDir })],
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? "0.0.0.0",
  manual: true,
});

const httpServer = server.node?.server;
if (!(httpServer instanceof HttpServer)) {
  throw new Error("Expected srvx to create a Node http.Server");
}

attachRealtime(httpServer);

await server.serve();
