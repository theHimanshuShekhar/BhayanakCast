import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANNED_CLOSE_CODE, SESSION_ENDED_CLOSE_CODE } from "../lib/realtime.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";
import type { RoomStore } from "./room-store.ts";

// A session that ends (sign-out, revoke) closes its own sockets, and only those (#63). Better
// Auth's session-delete hook (src/lib/auth.ts) tells the live hub (./live-hub.ts).

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  roomId = await h.createRoom(ana, { name: "ana's room" });
});

afterEach(async () => {
  await h.close();
});

const headersOf = (user: TestUser) => new Headers({ cookie: user.cookie });

describe("signing out", () => {
  it("closes the session's sockets, in the lobby and in a room, and the room sees them go", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    const bLobby = await h.connectAs(bo);

    await h.auth.api.signOut({ headers: headersOf(bo) });

    // Told why first (a page in a room says so), then closed.
    for (const socket of [b, bLobby]) {
      expect(await socket.waitFor("error")).toEqual({
        type: "error",
        code: "session_ended",
        message: "You were signed out",
      });
    }
    expect(await b.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(await bLobby.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(a.isClosed).toBe(false);
    await h.settled();
    // Like any lost socket: a reconnect grace, then they leave.
    await h.advance(30_000);
    expect(await a.waitForEvent("left")).toMatchObject({ event: { userId: bo.id } });
    // The cookie is dead: a new socket with it is anonymous.
    const again = await h.connectAs(bo);
    expect(again.received.find((m) => m.type === "welcome")).toMatchObject({ user: null });
  });

  it("leaves sockets of the user's other sessions open", async () => {
    const phone = await h.signInAgain(bo);
    const laptop = await h.connectAs(bo);
    const handset = await h.connectAs(phone);
    const a = await h.connectAs(ana);

    await h.auth.api.signOut({ headers: headersOf(bo) });

    expect(await laptop.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
    await h.settled();
    expect(handset.isClosed).toBe(false);
    expect(a.isClosed).toBe(false);
    // The surviving socket still works.
    await handset.join(roomId);
  });
});

describe("revoking sessions", () => {
  it("closes a revoked session's sockets, but not the one that revoked it", async () => {
    const phone = await h.signInAgain(bo);
    const laptop = await h.connectAs(bo);
    const handset = await h.connectAs(phone);

    // The phone signs the laptop out ("sign out other devices").
    await h.auth.api.revokeOtherSessions({ headers: headersOf(phone) });

    expect(await laptop.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
    await h.settled();
    expect(handset.isClosed).toBe(false);
  });

  it("closes every socket when all of a user's sessions are revoked", async () => {
    const phone = await h.signInAgain(bo);
    const laptop = await h.connectAs(bo);
    const handset = await h.connectAs(phone);

    await h.auth.api.revokeSessions({ headers: headersOf(bo) });

    expect(await laptop.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(await handset.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
  });
});

describe("a ban", () => {
  it("still tells the user they're banned: its session revocation doesn't pre-empt the notice", async () => {
    const root = await h.createUser("root", { admin: true });
    const b = await h.connectAs(bo);
    await b.join(roomId);

    // What src/server/admin-users.ts does: ban (which revokes the sessions), then disconnect.
    await h.auth.api.banUser({
      body: { userId: bo.id, banReason: "spam" },
      headers: headersOf(root),
    });
    await h.hub.disconnectUser(bo.id, "Reason: spam.");

    expect(await b.waitFor("error")).toMatchObject({ code: "banned", message: "Reason: spam." });
    expect(await b.closed()).toBe(BANNED_CLOSE_CODE);
  });
});

describe("when the database fails while dropping a socket", () => {
  it("still closes every socket of the session (and of a banned user)", async () => {
    let failing = false;
    await h.close();
    h = await startRealtimeHarness({
      wrapStore: (store) =>
        new Proxy(store, {
          get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            if (key !== "checkpointPresence" || typeof value !== "function") return value;
            return async (...args: unknown[]) => {
              if (failing) throw new Error("checkpointPresence is down");
              return Reflect.apply(value, target, args);
            };
          },
        }) as RoomStore,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      ana = await h.createUser("ana");
      bo = await h.createUser("bo");
      roomId = await h.createRoom(ana, { name: "ana's room" });
      // In a room first, so dropping it writes a checkpoint; the lobby socket comes after it.
      const inRoom = await h.connectAs(ana);
      await inRoom.join(roomId);
      const lobby = await h.connectAs(ana);
      const boRoom = await h.connectAs(bo);
      await boRoom.join(roomId);
      const boLobby = await h.connectAs(bo);
      failing = true;

      await h.auth.api.signOut({ headers: headersOf(ana) });
      expect(await inRoom.closed()).toBe(SESSION_ENDED_CLOSE_CODE);
      expect(await lobby.closed()).toBe(SESSION_ENDED_CLOSE_CODE);

      await h.hub.disconnectUser(bo.id, "Reason: spam.");
      expect(await boRoom.closed()).toBe(BANNED_CLOSE_CODE);
      expect(await boLobby.closed()).toBe(BANNED_CLOSE_CODE);
      failing = false;
    } finally {
      error.mockRestore();
    }
  });
});
