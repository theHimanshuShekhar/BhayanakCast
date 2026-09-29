import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ChatEntry,
  FEED_HISTORY_SIZE,
  type FeedEntry,
  type RoomParticipant,
  type ServerMessage,
} from "./realtime";
import {
  applyRoomMessage,
  CHAT_LINES_KEPT,
  feedLine,
  pendingShareAnswer,
  type RoomLive,
  SHARE_ACK_TIMEOUT_MS,
} from "./room-live";

const person = (userId: string): RoomParticipant => ({
  userId,
  username: userId,
  role: "member",
  joinedAt: "2026-09-27T10:00:00.000Z",
  media: { mic: false, cam: false, share: false },
});
const at = "2026-09-27T10:00:00.000Z";

const said = (id: string, text: string): ChatEntry => ({
  id,
  userId: "a",
  username: "a",
  role: "host",
  text,
  at,
});

const snapshot: ServerMessage = {
  type: "room.snapshot",
  roomId: "r1",
  name: "room",
  hostUserId: "a",
  participants: [person("a"), person("b")],
  chat: [said("c1", "earlier")],
  feed: [{ kind: "joined", id: "f1", at, userId: "b", username: "b" }],
};

describe("applyRoomMessage", () => {
  it("starts from the snapshot, then follows joins and leaves", () => {
    let state: RoomLive | null = applyRoomMessage(null, "r1", snapshot);
    state = applyRoomMessage(state, "r1", {
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "joined", participant: person("c") },
    });
    state = applyRoomMessage(state, "r1", {
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "left", userId: "a" },
    });
    expect(state).toEqual({
      roomId: "r1",
      name: "room",
      hostUserId: "a",
      participants: [person("b"), person("c")],
      chat: [
        { id: "c1", userId: "a", user: "a", role: "host", text: "earlier", at },
        { id: `joined:c:${at}`, system: true, text: "c joined", at },
        { id: `left:a:${at}`, system: true, text: "a left", at },
      ],
      feed: [{ kind: "joined", id: "f1", at, userId: "b", username: "b" }],
    });
  });

  it("appends chat messages for this room, keeping the latest lines", () => {
    let state = applyRoomMessage(null, "r1", snapshot);
    state = applyRoomMessage(state, "r1", {
      type: "chat.message",
      roomId: "r1",
      message: said("c2", "hi @b"),
    });
    expect(state?.chat.map((m) => m.text)).toEqual(["earlier", "hi @b"]);
    const other = applyRoomMessage(state, "r1", {
      type: "chat.message",
      roomId: "r2",
      message: said("c3", "elsewhere"),
    });
    expect(other).toBe(state);

    for (let i = 0; i < CHAT_LINES_KEPT; i++) {
      state = applyRoomMessage(state, "r1", {
        type: "chat.message",
        roomId: "r1",
        message: said(`m${i}`, `#${i}`),
      });
    }
    expect(state?.chat).toHaveLength(CHAT_LINES_KEPT);
    expect(state?.chat.at(-1)).toMatchObject({ text: `#${CHAT_LINES_KEPT - 1}` });
  });

  it("ignores other rooms and events before the snapshot", () => {
    const joined: ServerMessage = {
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "joined", participant: person("c") },
    };
    expect(applyRoomMessage(null, "r1", joined)).toBeNull();
    expect(
      applyRoomMessage(null, "r1", { type: "chat.message", roomId: "r1", message: said("x", "x") }),
    ).toBeNull();
    const state = applyRoomMessage(null, "r1", snapshot);
    expect(applyRoomMessage(state, "r1", { ...joined, roomId: "r2" })).toBe(state);
    expect(applyRoomMessage(state, "r1", { ...snapshot, roomId: "r2" })).toBe(state);
  });

  it("doesn't list someone twice when they join again", () => {
    const state = applyRoomMessage(null, "r1", snapshot);
    const next = applyRoomMessage(state, "r1", {
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "joined", participant: person("a") },
    });
    expect(next?.participants.map((p) => p.userId)).toEqual(["b", "a"]);
  });

  it("follows media state changes, adding no chat lines", () => {
    const state = applyRoomMessage(null, "r1", snapshot);
    const media = { mic: true, cam: false, share: true };
    const next = applyRoomMessage(state, "r1", {
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "stateChanged", userId: "b", media },
    });
    expect(next?.participants).toEqual([person("a"), { ...person("b"), media }]);
    expect(next?.chat).toBe(state?.chat);
  });

  it("follows the host grace and handover, moving the host role", () => {
    const hostChanged = (hostUserId: string, graceUntil: string | null): ServerMessage => ({
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "hostChanged", hostUserId, graceUntil },
    });
    const until = "2026-09-27T10:00:30.000Z";
    let state = applyRoomMessage(null, "r1", {
      ...snapshot,
      participants: [
        { ...person("a"), role: "host" },
        { ...person("b"), role: "mod" },
        person("c"),
      ],
      hostGraceUntil: until,
    });
    expect(state?.hostGraceUntil).toBe(until);

    // The host is back: the grace ends, nothing else changes.
    state = applyRoomMessage(state, "r1", hostChanged("a", null));
    expect(state).not.toHaveProperty("hostGraceUntil");
    expect(state?.chat.map((m) => m.text)).toEqual(["earlier"]);

    // Away again, then host passes to the mod.
    state = applyRoomMessage(state, "r1", hostChanged("a", until));
    expect(state?.hostGraceUntil).toBe(until);
    state = applyRoomMessage(state, "r1", hostChanged("b", null));
    expect(state).not.toHaveProperty("hostGraceUntil");
    expect(state?.hostUserId).toBe("b");
    expect(state?.participants.map((p) => [p.userId, p.role])).toEqual([
      ["a", "member"],
      ["b", "host"],
      ["c", "member"],
    ]);
    expect(state?.chat.at(-1)).toEqual({
      id: `host:b:${at}`,
      system: true,
      text: "b is the host now",
      at,
    });
  });

  it("follows moderation: roles, kicks and renames", () => {
    const event = (e: Extract<ServerMessage, { type: "room.event" }>["event"]): ServerMessage => ({
      type: "room.event",
      roomId: "r1",
      at,
      event: e,
    });
    const ana = { userId: "a", username: "a" };
    let state = applyRoomMessage(null, "r1", snapshot);
    expect(state?.name).toBe("room");

    state = applyRoomMessage(state, "r1", event({ kind: "roleChanged", userId: "b", role: "mod" }));
    expect(state?.participants.map((p) => p.role)).toEqual(["member", "mod"]);

    state = applyRoomMessage(state, "r1", event({ kind: "renamed", name: "new name", by: ana }));
    expect(state?.name).toBe("new name");
    expect(state?.chat.at(-1)?.text).toBe("a renamed the room to new name");

    state = applyRoomMessage(state, "r1", event({ kind: "kicked", userId: "b", by: ana }));
    expect(state?.participants.map((p) => p.userId)).toEqual(["a"]);
    expect(state?.chat.at(-1)?.text).toBe("b was removed by a");
  });
});

describe("the feed", () => {
  const entry = (id: string, userId = "a"): FeedEntry => ({
    kind: "joined",
    id,
    at,
    userId,
    username: userId,
  });

  it("puts new entries first, keeping the latest, for this room only", () => {
    let state = applyRoomMessage(null, "r1", snapshot);
    state = applyRoomMessage(state, "r1", { type: "feed.entry", roomId: "r1", entry: entry("f2") });
    expect(state?.feed.map((e) => e.id)).toEqual(["f2", "f1"]);
    expect(
      applyRoomMessage(state, "r1", { type: "feed.entry", roomId: "r2", entry: entry("x") }),
    ).toBe(state);
    expect(
      applyRoomMessage(null, "r1", { type: "feed.entry", roomId: "r1", entry: entry("x") }),
    ).toBeNull();

    for (let i = 0; i < FEED_HISTORY_SIZE; i++) {
      state = applyRoomMessage(state, "r1", {
        type: "feed.entry",
        roomId: "r1",
        entry: entry(`n${i}`),
      });
    }
    expect(state?.feed).toHaveLength(FEED_HISTORY_SIZE);
    expect(state?.feed[0]?.id).toBe(`n${FEED_HISTORY_SIZE - 1}`);
  });

  it("says what happened in words", () => {
    const base = { id: "f", at, userId: "a", username: "ana" };
    const mod = { userId: "m", username: "mo" };
    const words = (e: FeedEntry) => {
      const { who, what } = feedLine(e);
      return `${who} ${what}`;
    };
    expect(words({ ...base, kind: "joined" })).toBe("ana joined");
    expect(words({ ...base, kind: "left" })).toBe("ana left");
    expect(
      words({ ...base, kind: "reaction", emoji: "🔥", target: { userId: "b", username: "bo" } }),
    ).toBe("ana reacted 🔥 to bo");
    expect(
      words({ ...base, kind: "reaction", emoji: "✨", target: { userId: "a", username: "ana" } }),
    ).toBe("ana reacted ✨");
    expect(words({ ...base, kind: "shareStarted" })).toBe("ana started sharing");
    expect(words({ ...base, kind: "shareStopped" })).toBe("ana stopped sharing");
    expect(words({ ...base, kind: "shareStopped", by: mod })).toBe(
      "ana had their share stopped by mo",
    );
    expect(words({ ...base, kind: "roleChanged", role: "mod", by: mod })).toBe(
      "ana was made a mod by mo",
    );
    expect(words({ ...base, kind: "roleChanged", role: "member" })).toBe("ana is no longer a mod");
    expect(words({ ...base, kind: "hostChanged" })).toBe("ana is now the host");
    expect(words({ ...base, kind: "kicked", by: mod })).toBe("ana was removed by mo");
    expect(feedLine({ ...base, kind: "joined" })).toMatchObject({ id: "f", at });
  });
});

describe("pendingShareAnswer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out when the server doesn't answer within the click's window", async () => {
    vi.useFakeTimers();
    const { answer } = pendingShareAnswer();
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(SHARE_ACK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBe("timeout");
  });

  it("gives the server's answer when it comes in time, once", async () => {
    vi.useFakeTimers();
    const { answer, settle } = pendingShareAnswer();
    settle("accepted");
    settle("refused");
    await vi.advanceTimersByTimeAsync(SHARE_ACK_TIMEOUT_MS);
    expect(await answer).toBe("accepted");
  });
});
