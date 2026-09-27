import { describe, expect, it } from "vitest";
import type { ChatEntry, RoomParticipant, ServerMessage } from "./realtime";
import { applyRoomMessage, CHAT_LINES_KEPT, type RoomLive } from "./room-live";

const person = (userId: string): RoomParticipant => ({
  userId,
  username: userId,
  role: "member",
  joinedAt: "2026-09-27T10:00:00.000Z",
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
  hostUserId: "a",
  participants: [person("a"), person("b")],
  chat: [said("c1", "earlier")],
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
      hostUserId: "a",
      participants: [person("b"), person("c")],
      chat: [
        { id: "c1", userId: "a", user: "a", role: "host", text: "earlier", at },
        { id: `joined:c:${at}`, system: true, text: "c joined", at },
        { id: `left:a:${at}`, system: true, text: "a left", at },
      ],
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
});
