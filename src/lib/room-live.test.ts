import { describe, expect, it } from "vitest";
import type { RoomParticipant, ServerMessage } from "./realtime";
import { applyRoomMessage, type RoomLive } from "./room-live";

const person = (userId: string): RoomParticipant => ({
  userId,
  username: userId,
  role: "member",
  joinedAt: "2026-09-27T10:00:00.000Z",
});
const at = "2026-09-27T10:00:00.000Z";

const snapshot: ServerMessage = {
  type: "room.snapshot",
  roomId: "r1",
  hostUserId: "a",
  participants: [person("a"), person("b")],
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
    });
  });

  it("ignores other rooms and events before the snapshot", () => {
    const joined: ServerMessage = {
      type: "room.event",
      roomId: "r1",
      at,
      event: { kind: "joined", participant: person("c") },
    };
    expect(applyRoomMessage(null, "r1", joined)).toBeNull();
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
