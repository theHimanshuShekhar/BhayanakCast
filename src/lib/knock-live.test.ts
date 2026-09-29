import { describe, expect, it } from "vitest";
import { applyKnockMessage, applyPendingKnock, type KnockState } from "./knock-live";
import type { KnockEntry } from "./realtime";

const knocking: KnockState = { status: "knocking" };

describe("applyPendingKnock", () => {
  const bo: KnockEntry = {
    userId: "u-bo",
    username: "bo",
    image: null,
    at: "2026-09-01T12:00:00.000Z",
  };
  const cy: KnockEntry = {
    userId: "u-cy",
    username: "cy",
    image: null,
    at: "2026-09-01T12:01:00.000Z",
  };
  const pending = (knock: KnockEntry, roomId = "r1") =>
    ({ type: "knock.pending", roomId, knock }) as const;
  const resolved = (userId: string, roomId = "r1") =>
    ({ type: "knock.resolved", roomId, userId }) as const;

  it("adds knocks in order, a repeat in place, and drops resolved ones", () => {
    let knocks = applyPendingKnock([], "r1", pending(bo));
    knocks = applyPendingKnock(knocks, "r1", pending(cy));
    expect(knocks).toEqual([bo, cy]);
    const again = { ...bo, username: "bo2" };
    expect(applyPendingKnock(knocks, "r1", pending(again))).toEqual([again, cy]);
    expect(applyPendingKnock(knocks, "r1", resolved(bo.userId))).toEqual([cy]);
    // Someone not listed: nothing changes.
    expect(applyPendingKnock(knocks, "r1", resolved("u-nobody"))).toBe(knocks);
  });

  it("starts over on the room's snapshot, and ignores other rooms and messages", () => {
    const knocks = [bo];
    expect(
      applyPendingKnock(knocks, "r1", {
        type: "room.snapshot",
        roomId: "r1",
        name: "x",
        hostUserId: null,
        participants: [],
        chat: [],
        feed: [],
      }),
    ).toEqual([]);
    expect(applyPendingKnock(knocks, "r1", pending(cy, "r2"))).toBe(knocks);
    expect(applyPendingKnock(knocks, "r1", resolved(bo.userId, "r2"))).toBe(knocks);
    expect(applyPendingKnock(knocks, "r1", { type: "pong" })).toBe(knocks);
  });
});

describe("applyKnockMessage", () => {
  it("follows the server's knock.status", () => {
    const waiting = applyKnockMessage(knocking, {
      type: "knock.status",
      roomId: "r1",
      status: "waiting",
    });
    expect(waiting).toEqual({ status: "waiting", roomId: "r1" });
    expect(
      applyKnockMessage(waiting, { type: "knock.status", roomId: "r1", status: "approved" }),
    ).toEqual({ status: "approved", roomId: "r1" });
    expect(
      applyKnockMessage(waiting, { type: "knock.status", roomId: "r1", status: "denied" }),
    ).toEqual({ status: "denied", roomId: "r1" });
  });

  it("turns a refused knock into invalid (not_found) or an error", () => {
    expect(
      applyKnockMessage(knocking, {
        type: "error",
        code: "not_found",
        message: "This invite link is no longer valid",
        re: "knock.request",
      }),
    ).toEqual({ status: "invalid" });
    expect(
      applyKnockMessage(knocking, {
        type: "error",
        code: "internal",
        message: "Something went wrong, try again",
        re: "knock.request",
      }),
    ).toEqual({ status: "error", message: "Something went wrong, try again" });
  });

  it("follows waiting_for_host, room_full, expired and elsewhere too", () => {
    for (const status of ["waiting_for_host", "room_full", "expired", "elsewhere"] as const) {
      expect(applyKnockMessage(knocking, { type: "knock.status", roomId: "r1", status })).toEqual({
        status,
        roomId: "r1",
      });
    }
  });

  it("ignores everything else", () => {
    const state: KnockState = { status: "waiting", roomId: "r1" };
    expect(applyKnockMessage(state, { type: "pong" })).toBe(state);
    expect(
      applyKnockMessage(state, { type: "error", code: "forbidden", message: "x", re: "room.join" }),
    ).toBe(state);
  });
});
