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
import { getCommit, startedAt } from "./src/server/build-info.ts";
import { captureConsole } from "./src/server/console-capture.ts";
import { installCrashHandlers } from "./src/server/crash-handlers.ts";
import { env } from "./src/server/env.ts";
import { log } from "./src/server/logger.ts";
import { startMaintenance } from "./src/server/maintenance.ts";
import { createProdServer } from "./src/server/prod-server.ts";
import { createShutdown } from "./src/server/shutdown.ts";

// Before anything else prints: what TanStack Start and libraries write with console.* (Start prints
// a failed server function's whole error) goes through the logger and its redaction, not to stdout
// as it is, where it would reach the log store unredacted (src/server/console-capture.ts).
captureConsole();

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
// An unhandled rejection is logged and the server keeps running. An uncaught exception is logged
// and the server shuts down the same way (exit 1), and Docker restarts the container.
installCrashHandlers({ shutdown });

await server.serve();

// The boot line: which build, when it started, on which Node (docs/deploy.md, "Logs"). The commit
// is also on every line, as its `commit` field.
log.info("server.boot", `server started, commit ${getCommit().slice(0, 7)}`, {
  bootTime: startedAt(),
  node: process.version,
  port: env.PORT,
});
