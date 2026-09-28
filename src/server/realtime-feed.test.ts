import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FEED_HISTORY_SIZE,
  type FeedEntry,
  MEDIA_OFF,
  REACTION_RATE_LIMIT,
  type ServerMessage,
} from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";

// Reactions and the room feed (#28).

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
const T0 = "2026-09-01T12:00:00.000Z";
/** T0 plus `s` seconds, as an ISO string. */
const t = (s: number) => new Date(Date.parse(T0) + s * SECOND).toISOString();

/** `user` connected and in `room`, with the snapshot consumed. */
async function inRoom(user: TestUser, room = roomId): Promise<TestClient> {
  const client = await h.connectAs(user);
  await client.join(room);
  return client;
}

/** The feed entries `client` has received so far, oldest first (consumed or not). */
const feedSeen = (client: TestClient) =>
  client.received.flatMap((m) => (m.type === "feed.entry" ? [m.entry] : []));

/** An entry's gist, for comparing without ids. */
const gist = (entry: FeedEntry) => {
  const { id: _id, ...rest } = entry;
  return rest;
};

describe("reactions", () => {
  it("float on the target for everyone in the room, stamped by the server", async () => {
    const a = await inRoom(ana);
    const b = await inRoom(bo);
    await a.waitForEvent("joined");
    const cy = await h.createUser("cy");
    const elsewhere = await inRoom(cy, await h.createRoom(cy));

    await h.advance(2 * SECOND);
    b.send({ type: "reaction.send", emoji: "🔥", targetUserId: ana.id });
    const expected: ServerMessage = {
      type: "reaction",
      roomId,
      reaction: {
        id: expect.any(String),
        userId: bo.id,
        username: "bo",
        targetUserId: ana.id,
        emoji: "🔥",
        at: t(2),
      },
    };
    expect(await a.waitFor("reaction")).toEqual(expected);
    expect(await b.waitFor("reaction")).toEqual(expected);

    // Anyone can be the target, yourself included.
    a.send({ type: "reaction.send", emoji: "🫡", targetUserId: ana.id });
    expect((await b.waitFor("reaction")).reaction).toMatchObject({
      userId: ana.id,
      targetUserId: ana.id,
      emoji: "🫡",
    });
    await a.waitFor("reaction");

    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
    expect(elsewhere.pending()).toEqual([]);
    expect(elsewhere.received.some((m) => m.type === "reaction")).toBe(false);
  });

  it("refuses emoji outside the set, absent targets, and senders not in the room", async () => {
    const a = await inRoom(ana);
    const b = await h.connectAs(bo);

    a.sendRaw(JSON.stringify({ type: "reaction.send", emoji: "💩", targetUserId: ana.id }));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "reaction.send" });
    // bo is online but not in the room.
    a.send({ type: "reaction.send", emoji: "🔥", targetUserId: bo.id });
    expect(await a.waitFor("error")).toMatchObject({ code: "not_found", re: "reaction.send" });
    b.send({ type: "reaction.send", emoji: "🔥", targetUserId: ana.id });
    expect(await b.waitFor("error")).toMatchObject({ code: "forbidden", re: "reaction.send" });

    const visitor = await h.connect(null);
    visitor.send({ type: "hello", v: 1 });
    await visitor.waitFor("welcome");
    visitor.send({ type: "reaction.send", emoji: "🔥", targetUserId: ana.id });
    expect(await visitor.waitFor("error")).toMatchObject({ code: "forbidden" });

    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(a.received.some((m) => m.type === "reaction")).toBe(false);
  });

  it(`rate-limits each user to ${REACTION_RATE_LIMIT.reactions} in any ${REACTION_RATE_LIMIT.windowMs / SECOND} seconds`, async () => {
    const a = await inRoom(ana);
    const b = await inRoom(bo);
    await a.waitForEvent("joined");

    const react = async (client: TestClient) => {
      client.send({ type: "reaction.send", emoji: "✨", targetUserId: ana.id });
      return client.waitFor("reaction", (m) => m.reaction.userId === client.user?.id);
    };
    for (let i = 0; i < REACTION_RATE_LIMIT.reactions; i++) await react(a);
    a.send({ type: "reaction.send", emoji: "✨", targetUserId: ana.id });
    expect(await a.waitFor("error")).toMatchObject({ code: "rate_limited", re: "reaction.send" });
    // Others have their own allowance.
    await react(b);
    // Once the window has passed, reactions flow again (refusals didn't count).
    await h.advance(REACTION_RATE_LIMIT.windowMs);
    await react(a);
    for (let i = 0; i < REACTION_RATE_LIMIT.reactions + 1; i++) {
      await b.waitFor("reaction", (m) => m.reaction.userId === ana.id);
    }
    await h.settled();

    const reactors = (c: TestClient) =>
      c.received.flatMap((m) => (m.type === "reaction" ? [m.reaction.username] : []));
    const expected = [...Array(REACTION_RATE_LIMIT.reactions).fill("ana"), "bo", "ana"];
    expect(reactors(a)).toEqual(expected);
    expect(reactors(b)).toEqual(expected);
  });
});

describe("the feed", () => {
  it("logs joins, leaves, shares and reactions for everyone, and gives joiners the recent ones, newest first", async () => {
    const a = await inRoom(ana);
    await h.advance(SECOND);
    const b = await inRoom(bo);
    await h.advance(SECOND);
    b.send({ type: "media.state", ...MEDIA_OFF, share: true });
    await b.waitForEvent("stateChanged");
    await h.advance(SECOND);
    a.send({ type: "reaction.send", emoji: "💯", targetUserId: bo.id });
    await h.advance(SECOND);
    b.send({ type: "media.state", ...MEDIA_OFF });
    await b.waitForEvent("stateChanged");
    await h.advance(SECOND);
    await b.close();
    await h.settled();
    await h.advance(30 * SECOND); // bo's reconnect grace runs out: bo left when the socket closed
    await a.waitFor("feed.entry", (m) => m.entry.kind === "left");

    const who = { userId: bo.id, username: "bo" };
    const log = [
      { kind: "joined", at: t(0), userId: ana.id, username: "ana" },
      { kind: "joined", at: t(1), ...who },
      { kind: "shareStarted", at: t(2), ...who },
      {
        kind: "reaction",
        at: t(3),
        userId: ana.id,
        username: "ana",
        emoji: "💯",
        target: who,
      },
      { kind: "shareStopped", at: t(4), ...who },
      { kind: "left", at: t(5), ...who },
    ];
    expect(feedSeen(a).map(gist)).toEqual(log);
    // bo saw everything from their own arrival until they left.
    expect(feedSeen(b).map(gist)).toEqual(log.slice(1, 5));
    const ids = feedSeen(a).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    // A late joiner gets it all in the snapshot, newest first, then their own arrival live.
    const cy = await h.createUser("cy");
    const c = await h.connectAs(cy);
    const { feed } = await c.join(roomId);
    expect(feed).toEqual([...feedSeen(a)].reverse());
    expect((await c.waitFor("feed.entry")).entry).toMatchObject({ kind: "joined", userId: cy.id });
    expect((await a.waitFor("feed.entry", (m) => m.entry.userId === cy.id)).entry.kind).toBe(
      "joined",
    );
  });

  it(`keeps the last ${FEED_HISTORY_SIZE} entries`, async () => {
    const a = await inRoom(ana);
    for (let i = 0; i < FEED_HISTORY_SIZE; i++) {
      if (i > 0 && i % REACTION_RATE_LIMIT.reactions === 0) {
        await h.advance(REACTION_RATE_LIMIT.windowMs);
      }
      a.send({ type: "reaction.send", emoji: "⚡", targetUserId: ana.id });
      await a.waitFor("reaction");
    }
    const { feed } = await (await h.connectAs(bo)).join(roomId);
    expect(feed).toHaveLength(FEED_HISTORY_SIZE);
    // The oldest (ana joining) is gone; the newest reaction leads.
    expect(feed.every((e) => e.kind === "reaction")).toBe(true);
    expect(feed[0]).toEqual(feedSeen(a).findLast((e) => e.kind === "reaction"));
  });

  it("is kept in memory for the room's life only", async () => {
    const a = await inRoom(ana);
    a.send({ type: "reaction.send", emoji: "🎧", targetUserId: ana.id });
    await a.waitFor("reaction");

    // Back within the reconnect grace: the room, and its feed, are still there.
    await a.close();
    await h.advance(20 * SECOND);
    const again = await h.connectAs(ana);
    expect((await again.join(roomId)).feed.map((e) => e.kind)).toEqual(["reaction", "joined"]);

    // Dropped from memory once empty (#31 will keep empty rooms for 5 minutes, then end them).
    await again.close();
    await h.advance(30 * SECOND);
    const b = await h.connectAs(bo);
    expect((await b.join(roomId)).feed).toEqual([]);
  });

  it("is lost on a server restart", async () => {
    const a = await inRoom(ana);
    a.send({ type: "reaction.send", emoji: "🔥", targetUserId: ana.id });
    await a.waitFor("reaction");
    await h.restart();
    const again = await h.connectAs(ana);
    expect((await again.join(roomId)).feed).toEqual([]);
  });
});
