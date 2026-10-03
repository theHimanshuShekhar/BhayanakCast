import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createTestDb } from "../db/test-db.ts";
import { REALTIME_PATH } from "../lib/realtime.ts";
import { CLIENT_IP_HEADER } from "./client-ip.ts";
import { FakeClock } from "./clock.ts";
import { createProdServer } from "./prod-server.ts";
import { RoomHub } from "./room-hub.ts";
import { createDbRoomStore } from "./room-store.ts";

// The production server's own wiring (what server.prod.ts runs): a request's cf-connecting-ip
// is resolved before the app reads it, and nothing but the realtime socket takes upgrades.

let url: string;
let stop: () => Promise<void>;
let assetsDir: string;

/**
 * Boot the server on an ephemeral port, in a hook (it migrates PGlite), its app answering with
 * the client IP header it received.
 */
function bootsWith(trustedProxies: readonly string[]) {
  beforeEach(async () => {
    assetsDir = await mkdtemp(join(tmpdir(), "bhayanakcast-prod-server-"));
    const { db, close: closeDb } = await createTestDb();
    const { server, realtime } = createProdServer({
      app: {
        fetch: (request) => new Response(request.headers.get(CLIENT_IP_HEADER) ?? "none"),
      },
      clientDir: assetsDir,
      port: 0,
      hostname: "127.0.0.1",
      trustedProxies,
      realtime: { hub: new RoomHub({ clock: new FakeClock(), store: createDbRoomStore(db) }) },
    });
    stop = async () => {
      await realtime.close();
      await server.close(true);
      await closeDb();
    };
    await server.serve();
    await server.ready();
    url = server.url ?? "";
  });

  afterEach(async () => {
    await stop();
    await rm(assetsDir, { recursive: true, force: true });
  });
}

/** The client IP the app saw for a request carrying `headers`. */
async function seenBy(headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers });
  return response.text();
}

describe("a peer that isn't a trusted proxy", () => {
  bootsWith([]);

  it("is seen by the app as its socket address, whatever cf-connecting-ip it sends", async () => {
    expect(await seenBy({ [CLIENT_IP_HEADER]: "198.51.100.66" })).toBe("127.0.0.1");
    expect(await seenBy()).toBe("127.0.0.1");
  });

  it("can upgrade only to the realtime socket", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`${url.replace("http", "ws")}/not-the-socket`);
      ws.once("open", () => reject(new Error("Upgrade accepted")));
      ws.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      });
      ws.once("error", reject);
    });
    expect(status).toBe(404);
  });
});

describe("a trusted proxy", () => {
  bootsWith(["127.0.0.1"]);

  it("names the client in cf-connecting-ip, for the app to see", async () => {
    expect(await seenBy({ [CLIENT_IP_HEADER]: "203.0.113.7" })).toBe("203.0.113.7");
    // Without the header, or with one that isn't an IP, the proxy's own address stands in.
    expect(await seenBy()).toBe("127.0.0.1");
    expect(await seenBy({ [CLIENT_IP_HEADER]: "not-an-ip" })).toBe("127.0.0.1");
  });
});

describe("stop", () => {
  it("closes the realtime sockets and the listener, and resolves", async () => {
    const assets = await mkdtemp(join(tmpdir(), "bhayanakcast-prod-server-"));
    const { db, close: closeTestDb } = await createTestDb();
    const { server, stop } = createProdServer({
      app: { fetch: () => new Response("ok") },
      clientDir: assets,
      port: 0,
      hostname: "127.0.0.1",
      trustedProxies: [],
      realtime: { hub: new RoomHub({ clock: new FakeClock(), store: createDbRoomStore(db) }) },
    });
    try {
      await server.serve();
      await server.ready();
      const base = server.url ?? "";
      // `server.url` ends in a slash, so join the path with `URL` rather than by concatenation.
      const ws = new WebSocket(new URL(REALTIME_PATH, base.replace("http", "ws")));
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      const closed = new Promise((resolve) => ws.once("close", resolve));

      await stop();

      await closed;
      await expect(fetch(base)).rejects.toThrow();
    } finally {
      await closeTestDb();
      await rm(assets, { recursive: true, force: true });
    }
  });
});
