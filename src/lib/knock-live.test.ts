import { describe, expect, it } from "vitest";
import { applyKnockMessage, type KnockState } from "./knock-live";

const knocking: KnockState = { status: "knocking" };

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

  it("ignores everything else", () => {
    const state: KnockState = { status: "waiting", roomId: "r1" };
    expect(applyKnockMessage(state, { type: "pong" })).toBe(state);
    expect(
      applyKnockMessage(state, { type: "error", code: "forbidden", message: "x", re: "room.join" }),
    ).toBe(state);
  });
});
