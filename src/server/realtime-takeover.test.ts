import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presenceIntervals } from "../db/schema/index.ts";
import { ROOM_CAPACITY } from "../lib/format.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { RECONNECT_GRACE_MS } from "./room-hub.ts";

// Room capacity and one room per user: room_full and takeover (#26, ADR 21).

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  roomId = await h.createRoom(ana);
});

afterEach(async () => {
  await h.close();
});

const SECOND = 1_000;

/** `user` connected and in `room`, with the snapshot consumed. */
async function inRoom(user: TestUser, room = roomId): Promise<TestClient> {
  const client = await h.connectAs(user);
  await client.join(room);
  return client;
}

/** The room filled to capacity: ana (the host) first, then fresh guests, all connected. */
async function fillRoom(): Promise<{ clients: TestClient[]; users: TestUser[] }> {
  const users = [ana];
  const clients = [await inRoom(ana)];
  for (let i = 1; i < ROOM_CAPACITY; i++) {
    const guest = await h.createUser(`guest${i}`);
    users.push(guest);
    clients.push(await inRoom(guest));
  }
  await h.settled();
  return { clients, users };
}

/** `user`'s presence intervals in `room`, oldest first. */
async function presenceOf(user: TestUser, room = roomId) {
  const rows = await h.db
    .select({
      userId: presenceIntervals.userId,
      startedAt: presenceIntervals.startedAt,
      endedAt: presenceIntervals.endedAt,
    })
    .from(presenceIntervals)
    .where(eq(presenceIntervals.roomId, room))
    .orderBy(asc(presenceIntervals.startedAt));
  return rows
    .filter((row) => row.userId === user.id)
    .map((row) => ({
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    }));
}

describe("room capacity", () => {
  it(`refuses the ${ROOM_CAPACITY + 1}th join as room_full, and lets a retry in after a leave`, async () => {
    const { clients } = await fillRoom();
    const b = await h.connectAs(bo);

    b.send({ type: "room.join", roomId });
    expect(await b.waitFor("error")).toEqual({
      type: "error",
      code: "room_full",
      message: `This room is full (${ROOM_CAPACITY}/${ROOM_CAPACITY})`,
      re: "room.join",
    });
    await h.settled();
    // Nobody inside heard of the refused joiner.
    for (const client of clients) expect(JSON.stringify(client.pending())).not.toContain(bo.id);
    expect(await presenceOf(bo)).toEqual([]);

    clients[3]?.send({ type: "room.leave" });
    await clients[0]?.waitForEvent("left");
    // The waiting client learns of the free spot from the lobby, which is its cue to retry.
    await b.waitFor(
      "lobby.changed",
      (m) => m.room?.roomId === roomId && m.room.participantCount === ROOM_CAPACITY - 1,
    );
    const snapshot = await b.join(roomId);
    expect(snapshot.participants).toHaveLength(ROOM_CAPACITY);
    expect(snapshot.participants.at(-1)?.username).toBe("bo");
    await clients[0]?.waitForEvent("joined", (m) => m.event.participant.userId === bo.id);
  });

  it("counts people in their reconnect grace, until the grace runs out", async () => {
    const { clients } = await fillRoom();
    await clients[5]?.close();
    await h.settled();
    const b = await h.connectAs(bo);

    b.send({ type: "room.join", roomId });
    expect(await b.waitFor("error")).toMatchObject({ code: "room_full", re: "room.join" });

    await h.advance(RECONNECT_GRACE_MS);
    await clients[0]?.waitForEvent("left");
    const snapshot = await b.join(roomId);
    expect(snapshot.participants).toHaveLength(ROOM_CAPACITY);
  });

  it("lets someone already present back in to a full room", async () => {
    const { clients, users } = await fillRoom();
    await clients[5]?.close();
    await h.settled();
    const again = await h.connectAs(users[5] as TestUser);
    const snapshot = await again.join(roomId);
    expect(snapshot.participants).toHaveLength(ROOM_CAPACITY);

    // And a second connection of someone present takes over rather than being refused.
    const second = await h.connectAs(users[2] as TestUser);
    expect((await second.join(roomId)).participants).toHaveLength(ROOM_CAPACITY);
    expect(await clients[2]?.waitFor("error")).toMatchObject({ code: "taken_over" });
  });

  it("keeps a refused joiner in the room they were in", async () => {
    await fillRoom();
    const bosRoom = await h.createRoom(bo);
    const inBosRoom = await inRoom(bo, bosRoom);
    const other = await h.connectAs(bo);

    other.send({ type: "room.join", roomId });
    expect(await other.waitFor("error")).toMatchObject({ code: "room_full" });
    await h.settled();
    expect(inBosRoom.pending()).toEqual([]);
    expect(await presenceOf(bo, bosRoom)).toEqual([
      { startedAt: expect.any(String), endedAt: null },
    ]);
  });
});

describe("takeover", () => {
  it("in the same room: the new connection replaces the old one, with no leave or join", async () => {
    const a = await inRoom(ana);
    const b = await inRoom(bo);
    await a.waitForEvent("joined");
    await h.advance(5 * SECOND);

    const second = await h.connectAs(bo);
    const snapshot = await second.join(roomId);
    expect(snapshot.participants.map((p) => p.username)).toEqual(["ana", "bo"]);
    expect(await b.waitFor("error")).toEqual({
      type: "error",
      code: "taken_over",
      message: "You joined a room from another tab or device",
    });
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(b.isClosed).toBe(false);

    // The old connection is out of the room: it can't chat and hears nothing more.
    b.send({ type: "chat.send", text: "still here?" });
    expect(await b.waitFor("error")).toMatchObject({ code: "forbidden", re: "chat.send" });
    second.send({ type: "chat.send", text: "moved" });
    await a.waitFor("chat.message", (m) => m.message.text === "moved");
    await second.waitFor("chat.message");
    await h.settled();
    expect(b.pending()).toEqual([]);

    // Closing the old socket doesn't start a grace for the new one's presence.
    await b.close();
    await h.advance(RECONNECT_GRACE_MS * 2);
    expect(a.pending()).toEqual([]);
    expect(await presenceOf(bo)).toEqual([{ startedAt: expect.any(String), endedAt: null }]);
  });

  it("across rooms: the old connection is told and leaves its room", async () => {
    const a = await inRoom(ana);
    const b = await inRoom(bo);
    await a.waitForEvent("joined");
    const otherRoom = await h.createRoom(bo);
    await h.advance(7 * SECOND);

    const second = await h.connectAs(bo);
    await second.join(otherRoom);
    expect(await b.waitFor("error")).toMatchObject({ code: "taken_over" });
    const left = await a.waitForEvent("left");
    expect(left.event).toEqual({ kind: "left", userId: bo.id });
    expect(await presenceOf(bo)).toEqual([{ startedAt: expect.any(String), endedAt: left.at }]);
    expect(await presenceOf(bo, otherRoom)).toEqual([{ startedAt: left.at, endedAt: null }]);
    await h.settled();
    expect(b.pending()).toEqual([]);
  });

  it("leaves a second connection that isn't in a room alone", async () => {
    const a = await inRoom(ana);
    const idle = await h.connectAs(bo);
    await inRoom(bo);
    await a.waitForEvent("joined");
    await h.settled();
    expect(idle.pending()).toEqual([]);
  });

  it("the old connection can take the room back by joining again", async () => {
    await inRoom(ana);
    const b = await inRoom(bo);
    const second = await inRoom(bo);
    await b.waitFor("error");

    await b.join(roomId);
    expect(await second.waitFor("error")).toMatchObject({ code: "taken_over" });
  });
});
