import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presenceIntervals } from "../db/schema/index.ts";
import { BANNED_CLOSE_CODE } from "../lib/realtime.ts";
import { type RealtimeHarness, startRealtimeHarness, type TestUser } from "./realtime-harness.ts";

// A site-wide ban (#44, ADR 6): the hub disconnects the user everywhere, at once.

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

const SECOND = 1_000;
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();
const NOTICE = "Reason: spam. The ban has no end date.";

async function presenceOf(userId: string) {
  const rows = await h.db
    .select({ startedAt: presenceIntervals.startedAt, endedAt: presenceIntervals.endedAt })
    .from(presenceIntervals)
    .where(and(eq(presenceIntervals.roomId, roomId), eq(presenceIntervals.userId, userId)))
    .orderBy(asc(presenceIntervals.startedAt));
  return rows.map((r) => [r.startedAt.toISOString(), r.endedAt?.toISOString() ?? null]);
}

describe("disconnectUser", () => {
  it("tells every socket of the user they're banned, closes them, and the room sees them leave", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    // A second tab, in the lobby only.
    const bLobby = await h.connectAs(bo);
    await h.advance(10 * SECOND);

    await h.hub.disconnectUser(bo.id, NOTICE);

    for (const socket of [b, bLobby]) {
      expect(await socket.waitFor("error")).toEqual({
        type: "error",
        code: "banned",
        message: NOTICE,
      });
      expect(await socket.closed()).toBe(BANNED_CLOSE_CODE);
    }
    // At once, with no reconnect grace.
    expect(await a.waitForEvent("left")).toMatchObject({
      at: t(10),
      event: { kind: "left", userId: bo.id },
    });
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(await presenceOf(bo.id)).toEqual([[t(0), t(10)]]);
    // They're offline too.
    expect(a.pendingLobby().at(-1)).toMatchObject({ type: "lobby.changed", online: 1 });

    // Nothing happens when their grace would have run out.
    await h.advance(60 * SECOND);
    expect(a.pending()).toEqual([]);
  });

  it("hands host on at once when the banned user was the host", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");

    await h.hub.disconnectUser(ana.id, NOTICE);

    expect(await b.waitForEvent("hostChanged")).toMatchObject({
      event: { kind: "hostChanged", hostUserId: bo.id, graceUntil: null },
    });
    expect(await b.waitForEvent("left")).toMatchObject({ event: { userId: ana.id } });
    expect(await a.closed()).toBe(BANNED_CLOSE_CODE);
    await h.settled();
    expect(b.pending()).toEqual([]);
  });

  it("removes a user who is in their reconnect grace, as of when their socket closed", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    await h.advance(5 * SECOND);
    await b.close();
    await h.advance(10 * SECOND);

    await h.hub.disconnectUser(bo.id, NOTICE);

    expect(await a.waitForEvent("left")).toMatchObject({ at: t(5), event: { userId: bo.id } });
    await h.settled();
    expect(await presenceOf(bo.id)).toEqual([[t(0), t(5)]]);
  });

  it("does nothing for a user with no sockets and no room", async () => {
    const a = await h.connectAs(ana);
    await a.join(roomId);
    await h.hub.disconnectUser(bo.id, NOTICE);
    await h.settled();
    expect(a.pending()).toEqual([]);
  });
});
