import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamIntervals } from "../db/schema/index.ts";
import { MEDIA_OFF, type MediaState } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";

// Mic/cam/share state, the 3-streamer limit and stream intervals (#29).

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let dee: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  dee = await h.createUser("dee");
  roomId = await h.createRoom(ana);
});

afterEach(async () => {
  await h.close();
});

const SECOND = 1_000;
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();

const SHARING: MediaState = { ...MEDIA_OFF, share: true };

/** The room's stream intervals, by start then name. */
async function streamRows() {
  const name = (userId: string) => [ana, bo, cy, dee].find((u) => u.id === userId)?.username;
  const rows = await h.db
    .select({
      userId: streamIntervals.userId,
      startedAt: streamIntervals.startedAt,
      endedAt: streamIntervals.endedAt,
      lastSeenAt: streamIntervals.lastSeenAt,
    })
    .from(streamIntervals)
    .where(eq(streamIntervals.roomId, roomId))
    .orderBy(asc(streamIntervals.startedAt));
  return rows
    .map((row) => ({
      who: name(row.userId),
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt.toISOString(),
    }))
    .sort(
      (x, y) => x.startedAt.localeCompare(y.startedAt) || (x.who ?? "").localeCompare(y.who ?? ""),
    );
}

/** Each user connected and in the room, in order; each has seen everyone after them arrive. */
async function inRoom<const U extends TestUser[]>(
  ...users: U
): Promise<{ [K in keyof U]: TestClient }> {
  const clients: TestClient[] = [];
  for (const user of users) {
    const client = await h.connectAs(user);
    await client.join(roomId);
    for (const earlier of clients) await earlier.waitForEvent("joined");
    clients.push(client);
  }
  return clients as { [K in keyof U]: TestClient };
}

function announce(client: TestClient, media: MediaState) {
  client.send({ type: "media.state", ...media });
}

describe("media state", () => {
  it("is broadcast to everyone, the sender included, and is in the snapshot", async () => {
    const [a, b] = await inRoom(ana, bo);
    await h.advance(5 * SECOND);
    const media = { mic: true, cam: true, share: false };
    announce(a, media);
    for (const client of [a, b]) {
      expect(await client.waitForEvent("stateChanged")).toEqual({
        type: "room.event",
        roomId,
        at: t(5),
        event: { kind: "stateChanged", userId: ana.id, media },
      });
    }

    // Announcing the same state again changes nothing, so nobody hears about it.
    announce(a, media);
    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);

    const [c] = await inRoom(cy);
    const snapshot = c.received.find((m) => m.type === "room.snapshot");
    expect(
      snapshot?.type === "room.snapshot" && snapshot.participants.map((p) => [p.username, p.media]),
    ).toEqual([
      ["ana", media],
      ["bo", MEDIA_OFF],
      ["cy", MEDIA_OFF],
    ]);
  });

  it("tells the lobby when a public room's streamers change (room cards show them)", async () => {
    const [a] = await inRoom(ana);
    const watcher = await h.connectAs(dee);
    announce(a, { ...MEDIA_OFF, mic: true });
    announce(a, { mic: true, cam: false, share: true });
    expect(await watcher.waitFor("lobby.changed", (m) => m.room !== undefined)).toMatchObject({
      room: { roomId, change: "streamers", participantCount: 1 },
    });
    await h.settled();
    // The mic alone didn't concern the lobby.
    const roomChanges = watcher.pendingLobby().filter((m) => m.type === "lobby.changed" && m.room);
    expect(roomChanges).toEqual([]);
  });

  it("is refused from a socket that isn't in a room", async () => {
    const a = await h.connectAs(ana);
    announce(a, SHARING);
    expect(await a.waitFor("error")).toMatchObject({ code: "forbidden", re: "media.state" });
    expect(await streamRows()).toEqual([]);
  });

  it("is refused when malformed", async () => {
    const [a] = await inRoom(ana);
    a.sendRaw(JSON.stringify({ type: "media.state", mic: "yes" }));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "media.state" });
  });
});

describe("the 3-streamer limit", () => {
  it("refuses a 4th share start, still applying the rest, until someone stops", async () => {
    const [a, b, c, d] = await inRoom(ana, bo, cy, dee);
    for (const client of [a, b, c]) {
      announce(client, SHARING);
      await d.waitForEvent("stateChanged");
    }

    await h.advance(5 * SECOND);
    announce(d, { mic: true, cam: false, share: true });
    expect(await d.waitFor("error")).toEqual({
      type: "error",
      code: "share_limit",
      message: "3 people are already sharing",
      re: "media.state",
    });
    // The mic still turns on; the share stays off, for dee and everyone else.
    for (const client of [a, d]) {
      const changed = await client.waitForEvent("stateChanged", (m) => m.event.userId === dee.id);
      expect(changed.event.media).toEqual({ mic: true, cam: false, share: false });
    }
    expect((await streamRows()).map((r) => [r.who, r.endedAt])).toEqual([
      ["ana", null],
      ["bo", null],
      ["cy", null],
    ]);

    // A streamer stops: now dee's share is accepted, and confirmed to her.
    announce(b, MEDIA_OFF);
    await d.waitForEvent("stateChanged", (m) => m.event.userId === bo.id);
    announce(d, SHARING);
    expect(await d.waitForEvent("stateChanged", (m) => m.event.userId === dee.id)).toMatchObject({
      event: { media: SHARING },
    });
    expect((await streamRows()).map((r) => [r.who, r.endedAt])).toEqual([
      ["ana", null],
      ["bo", t(5)],
      ["cy", null],
      ["dee", null],
    ]);
  });

  it("counts a streamer in their reconnect grace", async () => {
    const [a, b, c, d] = await inRoom(ana, bo, cy, dee);
    for (const client of [a, b, c]) announce(client, SHARING);
    await h.settled();
    await c.close();
    await h.advance(10 * SECOND);
    announce(d, SHARING);
    expect(await d.waitFor("error")).toMatchObject({ code: "share_limit" });

    // Once cy's grace runs out her share goes with her.
    await h.advance(20 * SECOND);
    await d.waitForEvent("left");
    announce(d, SHARING);
    expect(await d.waitForEvent("stateChanged", (m) => m.event.userId === dee.id)).toMatchObject({
      event: { media: SHARING },
    });
  });
});

describe("stream intervals", () => {
  it("open and close with the share, on the server clock", async () => {
    const [a, b] = await inRoom(ana, bo);
    await h.advance(5 * SECOND);
    announce(a, SHARING);
    await b.waitForEvent("stateChanged");
    await h.advance(15 * SECOND);
    // Mic and camera alone don't touch the stream.
    announce(a, { mic: true, cam: true, share: true });
    await b.waitForEvent("stateChanged");
    expect(await streamRows()).toEqual([
      { who: "ana", startedAt: t(5), endedAt: null, lastSeenAt: t(5) },
    ]);
    await h.advance(5 * SECOND);
    announce(a, { mic: true, cam: true, share: false });
    await b.waitForEvent("stateChanged");
    await h.advance(10 * SECOND);
    announce(a, SHARING);
    await b.waitForEvent("stateChanged");
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["ana", t(5), t(25)],
      ["ana", t(35), null],
    ]);
  });

  it("close when the streamer leaves", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(b, SHARING);
    await a.waitForEvent("stateChanged");
    await h.advance(8 * SECOND);
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");
    await h.settled();
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["bo", T0, t(8)],
    ]);
  });

  it("carry on through a reconnect within the grace when the share is re-announced", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(b, SHARING);
    await a.waitForEvent("stateChanged");
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(15 * SECOND);

    const again = await h.connectAs(bo);
    const snapshot = await again.join(roomId);
    expect(snapshot.participants.find((p) => p.userId === bo.id)?.media).toEqual(SHARING);
    announce(again, SHARING);
    await h.advance(60 * SECOND);
    expect(a.pending()).toEqual([]);
    expect(again.pending()).toEqual([]);
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["bo", T0, null],
    ]);
  });

  it("end at the disconnect when a returner doesn't re-announce the share", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(b, SHARING);
    await a.waitForEvent("stateChanged");
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(15 * SECOND);

    // A reloaded page arrives with everything off.
    const again = await h.connectAs(bo);
    await again.join(roomId);
    announce(again, MEDIA_OFF);
    expect(await a.waitForEvent("stateChanged")).toMatchObject({
      at: t(25),
      event: { userId: bo.id, media: MEDIA_OFF },
    });
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["bo", T0, t(10)],
    ]);
  });

  it("end at the disconnect when the grace runs out", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(b, SHARING);
    await a.waitForEvent("stateChanged");
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(30 * SECOND);
    expect(await a.waitForEvent("left")).toMatchObject({ at: t(10) });
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["bo", T0, t(10)],
    ]);
  });

  it("get last_seen_at checkpoints like presence, stopping at the disconnect", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(a, SHARING);
    announce(b, SHARING);
    await h.settled();
    await h.advance(60 * SECOND);
    expect((await streamRows()).map((r) => [r.who, r.lastSeenAt])).toEqual([
      ["ana", t(60)],
      ["bo", t(60)],
    ]);
    await h.advance(10 * SECOND);
    await b.close();
    await h.advance(50 * SECOND);
    expect((await streamRows()).map((r) => [r.who, r.lastSeenAt, r.endedAt])).toEqual([
      ["ana", t(120), null],
      ["bo", t(70), t(70)],
    ]);
  });
});

describe("stream intervals and takeover", () => {
  it("carry on through a same-room takeover only if the new tab re-announces the share", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(b, SHARING);
    await a.waitForEvent("stateChanged");
    await h.advance(10 * SECOND);

    // A second tab that keeps sharing (the same stream): nothing changes.
    const tab2 = await h.connectAs(bo);
    await tab2.join(roomId);
    expect(await b.waitFor("error")).toMatchObject({ code: "taken_over" });
    announce(tab2, SHARING);
    await h.advance(5 * SECOND);
    expect(a.pending()).toEqual([]);

    // A third that arrives with nothing on: the share ends now.
    const tab3 = await h.connectAs(bo);
    await tab3.join(roomId);
    announce(tab3, MEDIA_OFF);
    expect(await a.waitForEvent("stateChanged")).toMatchObject({
      at: t(15),
      event: { userId: bo.id, media: MEDIA_OFF },
    });
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["bo", T0, t(15)],
    ]);
  });

  it("close with the presence when the streamer takes over into another room", async () => {
    const other = await h.createRoom(cy);
    const [a, b] = await inRoom(ana, bo);
    announce(b, SHARING);
    await a.waitForEvent("stateChanged");
    await h.advance(10 * SECOND);

    const elsewhere = await h.connectAs(bo);
    await elsewhere.join(other);
    expect(await a.waitForEvent("left")).toMatchObject({ at: t(10), event: { userId: bo.id } });
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["bo", T0, t(10)],
    ]);
  });
});

describe("stream intervals across a restart", () => {
  it("continue for a streamer who returns sharing; the rest end at their last seen", async () => {
    const [a, b] = await inRoom(ana, bo);
    announce(a, SHARING);
    announce(b, SHARING);
    await h.settled();
    await h.advance(65 * SECOND); // one checkpoint, at 60s
    await h.restart({ downFor: 5 * SECOND });

    const a2 = await h.connectAs(ana);
    const snapshot = await a2.join(roomId);
    const media = snapshot.participants.map((p) => [p.username, p.media]);
    expect(media.sort()).toEqual([
      ["ana", SHARING],
      ["bo", SHARING],
    ]);
    announce(a2, SHARING);

    // bo never comes back: his stream ends with his presence, at the checkpoint.
    await h.advance(30 * SECOND);
    expect(await a2.waitForEvent("left")).toMatchObject({ at: t(60), event: { userId: bo.id } });
    expect((await streamRows()).map((r) => [r.who, r.startedAt, r.endedAt])).toEqual([
      ["ana", T0, null],
      ["bo", T0, t(60)],
    ]);
  });

  it("close at their last seen when too old to resume", async () => {
    const [a] = await inRoom(ana);
    announce(a, SHARING);
    await h.settled();
    await h.advance(70 * SECOND);
    await h.restart({ downFor: 10 * 60 * SECOND });
    expect((await streamRows()).map((r) => [r.who, r.endedAt])).toEqual([["ana", t(60)]]);

    const a2 = await h.connectAs(ana);
    expect((await a2.join(roomId)).participants.map((p) => p.media)).toEqual([MEDIA_OFF]);
  });
});
