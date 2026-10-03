/**
 * Production server entry (ADR 0005). Serves the built client assets and the
 * TanStack Start SSR handler from one Node `http.Server`, so the realtime
 * WebSocket endpoint (ADR 0004) can attach to the same server. The wiring
 * is `createProdServer` (src/server/prod-server.ts).
 *
 * Run after `pnpm build` with `pnpm start` (Node runs this .ts file natively).
 */
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./src/db/client.ts";
import { env } from "./src/server/env.ts";
import { startMaintenance } from "./src/server/maintenance.ts";
import { createProdServer } from "./src/server/prod-server.ts";
import { createShutdown } from "./src/server/shutdown.ts";

type ServerEntry = { fetch(request: Request): Response | Promise<Response> };

const clientDir = fileURLToPath(new URL("./dist/client", import.meta.url));
const serverEntryUrl = new URL("./dist/server/server.js", import.meta.url).href;

const { default: app } = (await import(serverEntryUrl)) as { default: ServerEntry };

const { server, stop } = createProdServer({
  app,
  clientDir,
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST ?? "0.0.0.0",
  trustedProxies: env.TRUSTED_PROXY_IPS,
});

// Daily retention purge + stats roll-up (ADR 11).
const maintenance = startMaintenance(getDb());

await server.serve();

// `docker stop` sends SIGTERM and kills after 10 s. So: stop the maintenance timer, stop the
// server (no new connections, realtime sockets closed, which checkpoints each presence interval),
// end the database pool, whose sockets would keep the process alive, and exit. If a step hangs,
// `createShutdown` exits after 8 s anyway.
const shutdown = createShutdown([
  { name: "maintenance", run: () => maintenance.stop() },
  { name: "http server and realtime", run: () => stop() },
  { name: "database pool", run: () => closeDb() },
]);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void shutdown(signal));
}
