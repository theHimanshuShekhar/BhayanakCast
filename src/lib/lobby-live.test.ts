import { afterEach, describe, expect, it, vi } from "vitest";
import { homeKeys } from "./home.queries.ts";
import { coalesce, lobbyInvalidations } from "./lobby-live.ts";
import type { LOBBY_ROOM_CHANGES, ServerMessage } from "./realtime.ts";
import { roomKeys } from "./rooms.queries.ts";

const changed = (change: (typeof LOBBY_ROOM_CHANGES)[number]): ServerMessage => ({
  type: "lobby.changed",
  online: 1,
  room: { roomId: "r1", change, participantCount: 0 },
});

describe("lobbyInvalidations", () => {
  it("refreshes the live list and home summary for a room's list-level changes", () => {
    for (const change of ["created", "count", "streamers", "renamed", "host"] as const) {
      expect(lobbyInvalidations(changed(change), false)).toEqual([
        roomKeys.live(),
        homeKeys.summary(),
      ]);
    }
  });

  it("refreshes only the live list for a new thumbnail", () => {
    expect(lobbyInvalidations(changed("thumbnail"), false)).toEqual([roomKeys.live()]);
  });

  it("refreshes everything when a room ended", () => {
    expect(lobbyInvalidations(changed("ended"), false)).toEqual([roomKeys.all, homeKeys.summary()]);
  });

  it("refreshes every room read on a reconnect's snapshot only", () => {
    const snapshot: ServerMessage = { type: "lobby.snapshot", online: 1 };
    expect(lobbyInvalidations(snapshot, false)).toEqual([]);
    expect(lobbyInvalidations(snapshot, true)).toEqual([roomKeys.all]);
    expect(lobbyInvalidations({ type: "lobby.changed", online: 2 }, false)).toEqual([]);
  });
});

describe("coalesce", () => {
  afterEach(() => vi.useRealTimers());

  it("runs at once, and a burst afterwards becomes one run when the wait ends", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const call = coalesce(run, 5_000);
    call();
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) call();
    vi.advanceTimersByTime(4_999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    // Nothing more was asked for, so nothing runs, and the next call is immediate again.
    vi.advanceTimersByTime(20_000);
    expect(run).toHaveBeenCalledTimes(2);
    call();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
