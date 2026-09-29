import { afterEach, describe, expect, it, vi } from "vitest";
import { homeKeys } from "./home.queries.ts";
import { coalesce, lobbyInvalidations, ONLINE_SETTLE_MS, settleOnline } from "./lobby-live.ts";
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

describe("settleOnline", () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const shown: number[] = [];
    return { shown, online: settleOnline((n) => shown.push(n)) };
  }

  it("never shows a dip that recovers within the window", () => {
    const { shown, online } = setup();
    online.snapshot(5);
    online.changed(4);
    vi.advanceTimersByTime(ONLINE_SETTLE_MS - 1);
    online.changed(5);
    vi.advanceTimersByTime(ONLINE_SETTLE_MS);
    // The 5 that settled is the value already shown; the 4 never reached the store.
    expect(shown).not.toContain(4);
    expect(shown.at(-1)).toBe(5);
  });

  it("shows a lasting change once it has held for the window", () => {
    const { shown, online } = setup();
    online.snapshot(5);
    online.changed(6);
    vi.advanceTimersByTime(ONLINE_SETTLE_MS - 1);
    expect(shown).toEqual([5]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual([5, 6]);
  });

  it("applies a snapshot at once and drops the pending count", () => {
    const { shown, online } = setup();
    online.changed(9);
    online.snapshot(5);
    expect(shown).toEqual([5]);
    vi.advanceTimersByTime(2 * ONLINE_SETTLE_MS);
    expect(shown).toEqual([5]);
  });

  it("shows nothing after being cancelled", () => {
    const { shown, online } = setup();
    online.changed(9);
    online.cancel();
    vi.advanceTimersByTime(2 * ONLINE_SETTLE_MS);
    expect(shown).toEqual([]);
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
