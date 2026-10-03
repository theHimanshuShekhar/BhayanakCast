import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHAT_RATE_LIMIT } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { RECONNECT_GRACE_MS, SEND_HISTORY_KEEP_MS } from "./room-hub.ts";

// The hub's per-user memory doesn't grow without bound (#63): send histories go once their
// user has had no socket for a while, and "ended while away" notes once the grace they were
// for is over. `hub.retained` counts what is still held.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let roomId: string;
let a: TestClient;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  roomId = await h.createRoom(ana, { name: "ana's room" });
  a = await h.connectAs(ana);
  await a.join(roomId);
});

afterEach(async () => {
  await h.close();
});

const SECOND = 1_000;

/** `user` in the room, who has chatted, reacted to ana and signalled her once each. */
async function activeMember(user: TestUser): Promise<TestClient> {
  const client = await h.connectAs(user);
  await client.join(roomId);
  await a.waitForEvent("joined");
  client.send({ type: "chat.send", text: "hi" });
  client.send({ type: "reaction.send", targetUserId: ana.id, emoji: "🔥" });
  client.send({ type: "signal", to: ana.id, payload: { kind: "hello", session: "pc-1" } });
  await a.waitFor("chat.message");
  await a.waitFor("reaction");
  await a.waitFor("signal");
  return client;
}

describe("send histories", () => {
  it("are dropped once their user has had no socket for the longest window", async () => {
    const b = await activeMember(bo);
    expect(h.hub.retained.sendHistories).toBeGreaterThan(0);

    // Still held while a socket is open, however long it has been.
    await h.advance(SEND_HISTORY_KEEP_MS * 2);
    expect(h.hub.retained.sendHistories).toBeGreaterThan(0);

    await b.close();
    await h.settled();
    // Not at once: a rate limit has to survive a quick reconnect.
    expect(h.hub.retained.sendHistories).toBeGreaterThan(0);
    await h.advance(SEND_HISTORY_KEEP_MS);
    expect(h.hub.retained.sendHistories).toBe(0);
  });

  it("outlast a quick reconnect, so reconnecting doesn't reset a rate limit", async () => {
    const b = await h.connectAs(bo);
    await b.join(roomId);
    for (let i = 0; i < CHAT_RATE_LIMIT.messages; i++) {
      b.send({ type: "chat.send", text: `m${i}` });
      await a.waitFor("chat.message");
    }
    await b.close();
    await h.settled();

    const again = await h.connectAs(bo);
    await again.join(roomId);
    again.send({ type: "chat.send", text: "one too many" });
    expect(await again.waitFor("error")).toMatchObject({ code: "rate_limited", re: "chat.send" });
  });

  it("are kept when the user is back online before the window is over, and dropped after their next exit", async () => {
    const b = await activeMember(bo);
    await b.close();
    await h.settled();
    const back = await h.connectAs(bo);
    await h.advance(SEND_HISTORY_KEEP_MS);
    // Online again when the first timer fired: that one is not what clears them.
    expect(h.hub.retained.sendHistories).toBeGreaterThan(0);

    await back.close();
    await h.settled();
    await h.advance(SEND_HISTORY_KEEP_MS);
    expect(h.hub.retained.sendHistories).toBe(0);
  });

  it("are kept for a user who still has another socket open", async () => {
    const b = await activeMember(bo);
    const other = await h.connectAs(bo);
    await b.close();
    await h.settled();

    await h.advance(SEND_HISTORY_KEEP_MS * 2);
    expect(other.isClosed).toBe(false);
    expect(h.hub.retained.sendHistories).toBeGreaterThan(0);
  });
});

describe("ended-while-away notes", () => {
  /** bo is in the room, drops, and an admin ends it a few seconds later. */
  async function endedWhileBoWasAway() {
    const b = await h.connectAs(bo);
    await b.join(roomId);
    await a.waitForEvent("joined");
    await b.close();
    await h.advance(5 * SECOND);
    await h.hub.endRoomByAdmin(roomId);
    await a.waitForEvent("ended");
    expect(h.hub.retained.endedWhileAway).toBe(1);
  }

  it("are dropped once the reconnect grace they stand in for is over", async () => {
    await endedWhileBoWasAway();

    await h.advance(RECONNECT_GRACE_MS);
    expect(h.hub.retained.endedWhileAway).toBe(0);

    // Too late to be told it ended: the room is simply gone.
    const back = await h.connectAs(bo);
    back.send({ type: "room.join", roomId });
    expect(await back.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
  });

  it("are dropped when their user comes back and is told", async () => {
    await endedWhileBoWasAway();

    const back = await h.connectAs(bo);
    back.send({ type: "room.join", roomId });
    expect(await back.waitForEvent("ended")).toMatchObject({ event: { reason: "admin" } });
    expect(h.hub.retained.endedWhileAway).toBe(0);
  });
});
