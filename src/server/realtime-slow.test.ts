import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNAL_RATE_LIMIT, type SignalPayload } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  type RealtimeHarnessOptions,
  startRealtimeHarness,
} from "./realtime-harness.ts";
import { RECONNECT_GRACE_MS } from "./room-hub.ts";
import type { RoomStore } from "./room-store.ts";

// A client that stops reading and a database that stalls (#61): neither may hold up the hub.

let h: RealtimeHarness;

afterEach(async () => {
  vi.restoreAllMocks();
  await h.close();
});

describe("a client that stops reading", () => {
  /** Far under `MAX_BUFFERED_BYTES`, so the test needn't push megabytes past the kernel's buffers. */
  const TINY_LIMIT = 64 * 1024;
  /** A signal near the largest one a client may send (`MAX_CLIENT_MESSAGE_BYTES` is 64 KB). */
  const BIG_OFFER: SignalPayload = {
    kind: "description",
    session: "pc-1",
    description: { type: "offer", sdp: "v".repeat(60_000) },
  };

  it("is dropped once its send buffer passes the threshold, and the hub is told", async () => {
    h = await startRealtimeHarness({ maxBufferedBytes: TINY_LIMIT });
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const roomId = await h.createRoom(ana);
    const a = await h.connectAs(ana);
    await a.join(roomId);
    // No heartbeat: bo reads nothing from here on, pongs included.
    const b = await h.connectAs(bo, { heartbeat: false });
    await b.join(roomId);
    await a.waitForEvent("joined");

    b.stopReading();
    // Well past what the loopback socket buffers hold between them, so the server's backlog grows.
    const flood = SIGNAL_RATE_LIMIT.messages - 10;
    for (let i = 0; i < flood; i++) {
      a.send({ type: "signal", to: bo.id, payload: BIG_OFFER });
    }
    await h.settled();
    expect(a.isClosed).toBe(false);

    // The server dropped the socket rather than buffering all of it: bo sees what was already
    // sent, then the connection end, without a close frame (it was never sent).
    b.resumeReading();
    expect(await b.closed()).toBe(1006);
    expect(b.received.filter((m) => m.type === "signal").length).toBeLessThan(flood);

    // The hub saw the disconnect like any other: bo leaves once the reconnect grace runs out.
    await h.advance(RECONNECT_GRACE_MS);
    await a.waitForEvent("left", (m) => m.event.userId === bo.id);
    // 30 s: it relays ~20 MB through the real hub, which a loaded machine takes a while over.
  }, 30_000);
});

describe("a database that stalls", () => {
  /** What Drizzle throws for a statement over `statement_timeout`: the Postgres error is its cause. */
  const timeoutError = () =>
    new Error("Failed query: select 1", {
      cause: Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      }),
    });
  /** How long the stalled call hangs before it fails (a stand-in for `STATEMENT_TIMEOUT_MS`). */
  const STALL_MS = 100;
  /** While set, the next `isKicked` (the first step of a join) stalls, then fails like a timeout. */
  let failNextJoin = false;

  async function start(options: RealtimeHarnessOptions = {}) {
    failNextJoin = false;
    h = await startRealtimeHarness({
      ...options,
      wrapStore: (store) =>
        new Proxy(store, {
          get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            if (typeof value !== "function" || typeof key !== "string") return value;
            return async (...args: unknown[]) => {
              if (key === "isKicked" && failNextJoin) {
                failNextJoin = false;
                await new Promise((resolve) => setTimeout(resolve, STALL_MS));
                throw timeoutError();
              }
              return Reflect.apply(value, target, args);
            };
          },
        }) as RoomStore,
    });
  }

  it("fails the operation, logs it, and lets the queue move on", async () => {
    await start();
    const ana = await h.createUser("ana");
    const bo = await h.createUser("bo");
    const roomId = await h.createRoom(ana);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await h.connectAs(ana, { heartbeat: false });
    const b = await h.connectAs(bo);

    // ana's join hangs on the database; her ping and bo's join queue up behind it.
    failNextJoin = true;
    a.send({ type: "room.join", roomId });
    a.send({ type: "ping" });
    const snapshot = b.join(roomId);

    const error = await a.waitFor("error", (e) => e.re === "room.join");
    expect(error.code).toBe("internal");
    await a.waitFor("pong");
    expect(a.received.findIndex((m) => m.type === "error")).toBeLessThan(
      a.received.findIndex((m) => m.type === "pong"),
    );
    expect((await snapshot).roomId).toBe(roomId);
    expect(logged).toHaveBeenCalledWith(
      "[realtime] room.join failed",
      expect.objectContaining({ cause: expect.objectContaining({ code: "57014" }) }),
    );

    // The failed join left nothing behind: ana can simply try again.
    expect((await a.join(roomId)).roomId).toBe(roomId);
    await h.settled();
    expect(h.hub.queued).toBe(0);
  }, 30_000);
});
