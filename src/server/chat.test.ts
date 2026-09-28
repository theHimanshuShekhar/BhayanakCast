import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHAT_HISTORY_SIZE, CHAT_MAX_LENGTH, CHAT_RATE_LIMIT } from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";
import { EMPTY_ROOM_TIMEOUT_MS } from "./room-hub.ts";

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

/** `user` connected and in `room`, with the snapshot and any join events consumed. */
async function inRoom(user: TestUser, room = roomId): Promise<TestClient> {
  const client = await h.connectAs(user);
  await client.join(room);
  return client;
}

/** Send `count` messages from `client`, each echoed back, staying under the rate limit. */
async function chatter(client: TestClient, count: number, label = (i: number) => `#${i}`) {
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % CHAT_RATE_LIMIT.messages === 0) await h.advance(CHAT_RATE_LIMIT.windowMs);
    client.send({ type: "chat.send", text: label(i) });
    await client.waitFor("chat.message", (m) => m.message.text === label(i));
  }
}

describe("chat", () => {
  it("fans a message out to everyone in the room, stamped by the server", async () => {
    const a = await inRoom(ana);
    const b = await inRoom(bo);
    await a.waitForEvent("joined");
    const carol = await h.createUser("carol");
    const elsewhere = await inRoom(carol, await h.createRoom(carol));

    await h.advance(3 * SECOND);
    b.send({ type: "chat.send", text: "  hi @ana, look: https://example.com  " });
    const expected = {
      type: "chat.message",
      roomId,
      message: {
        id: expect.any(String),
        userId: bo.id,
        username: "bo",
        role: "member",
        text: "hi @ana, look: https://example.com",
        at: "2026-09-01T12:00:03.000Z",
      },
    };
    expect(await a.waitFor("chat.message")).toEqual(expected);
    expect(await b.waitFor("chat.message")).toEqual(expected);

    a.send({ type: "chat.send", text: "hey bo" });
    const fromHost = await b.waitFor("chat.message");
    expect(fromHost.message).toMatchObject({ userId: ana.id, role: "host", text: "hey bo" });
    await a.waitFor("chat.message");

    await h.settled();
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
    expect(elsewhere.pending()).toEqual([]);
  });

  it("gives a late joiner exactly the last 50 messages, oldest first", async () => {
    const a = await inRoom(ana);
    await chatter(a, CHAT_HISTORY_SIZE + 5);

    const b = await h.connectAs(bo);
    const { chat } = await b.join(roomId);
    expect(chat).toHaveLength(CHAT_HISTORY_SIZE);
    expect(chat.map((m) => m.text)).toEqual(
      Array.from({ length: CHAT_HISTORY_SIZE }, (_, i) => `#${i + 5}`),
    );
    expect(chat[0]).toMatchObject({ userId: ana.id, username: "ana", role: "host" });
    expect(new Set(chat.map((m) => m.id)).size).toBe(CHAT_HISTORY_SIZE);
  });

  it("rate-limits each user to 5 messages in any 5 seconds", async () => {
    const a = await inRoom(ana);
    const b = await inRoom(bo);
    await a.waitForEvent("joined");

    const say = async (client: TestClient, text: string) => {
      client.send({ type: "chat.send", text });
      await client.waitFor("chat.message", (m) => m.message.text === text);
    };
    for (let i = 0; i < CHAT_RATE_LIMIT.messages; i++) {
      await say(a, `m${i}`);
      await h.advance(SECOND);
    }
    // 5 sent at 0–4s: a 6th at 5s is fine (the one at 0s has aged out), a 7th isn't.
    await say(a, "sixth");
    a.send({ type: "chat.send", text: "seventh" });
    expect(await a.waitFor("error")).toMatchObject({ code: "rate_limited", re: "chat.send" });
    // Refused messages don't count against the limit, and other users have their own.
    await say(b, "bo's turn");
    await h.advance(SECOND);
    await say(a, "eighth");
    await b.waitFor("chat.message", (m) => m.message.text === "eighth");
    await h.settled();

    const texts = (c: TestClient) =>
      c.received.flatMap((m) => (m.type === "chat.message" ? [m.message.text] : []));
    const expected = ["m0", "m1", "m2", "m3", "m4", "sixth", "bo's turn", "eighth"];
    expect(texts(a)).toEqual(expected);
    expect(texts(b)).toEqual(expected);
    expect(b.received.filter((m) => m.type === "error")).toEqual([]);
  });

  it("caps messages at 500 characters after trimming and refuses empty ones", async () => {
    const a = await inRoom(ana);
    const longest = "x".repeat(CHAT_MAX_LENGTH);

    a.send({ type: "chat.send", text: `${longest}x` });
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "chat.send" });
    a.send({ type: "chat.send", text: "   \n\t " });
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "chat.send" });

    a.send({ type: "chat.send", text: `  ${longest}  ` });
    expect((await a.waitFor("chat.message")).message.text).toBe(longest);
    await h.settled();
    expect(a.pending()).toEqual([]);
  });

  it("refuses chat from a socket that isn't in a room", async () => {
    const a = await h.connectAs(ana);
    a.send({ type: "chat.send", text: "anyone?" });
    expect(await a.waitFor("error")).toMatchObject({ code: "forbidden", re: "chat.send" });

    await a.join(roomId);
    a.send({ type: "room.leave" });
    a.send({ type: "chat.send", text: "still here?" });
    expect(await a.waitFor("error")).toMatchObject({ code: "forbidden", re: "chat.send" });
  });

  it("keeps history in memory only, discarding it with the room", async () => {
    const a = await inRoom(ana);
    await chatter(a, 3);

    // A return within the reconnect grace finds the room, and its history, still there.
    await a.close();
    await h.advance(20_000);
    const again = await h.connectAs(ana);
    expect((await again.join(roomId)).chat).toHaveLength(3);

    // An empty room keeps its history while it waits for someone (ADR 14)…
    again.send({ type: "room.leave" });
    await h.advance(60_000);
    const b = await h.connectAs(bo);
    expect((await b.join(roomId)).chat).toHaveLength(3);

    // …and it goes with the room when nobody joins in time: the room is a past stream now.
    b.send({ type: "room.leave" });
    await h.advance(EMPTY_ROOM_TIMEOUT_MS);
    b.send({ type: "room.join", roomId });
    expect(await b.waitFor("error")).toMatchObject({ code: "not_found", re: "room.join" });
  });
});
