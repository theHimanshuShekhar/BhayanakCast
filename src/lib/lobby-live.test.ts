import { afterEach, describe, expect, it, vi } from "vitest";
import { homeKeys } from "./home.queries.ts";
import {
  coalesce,
  invalidateLobbyKeys,
  lobbyInvalidations,
  ONLINE_SETTLE_MS,
  settleOnline,
} from "./lobby-live.ts";
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

describe("invalidateLobbyKeys", () => {
  afterEach(() => vi.useRealTimers());

  it("invalidates every key but the home summary at once, and the summary through the coalesced refetch", () => {
    const client = { invalidateQueries: vi.fn() };
    const refetchSummary = vi.fn();
    invalidateLobbyKeys(client, [roomKeys.live(), homeKeys.summary()], refetchSummary);
    expect(client.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(refetchSummary).toHaveBeenCalledTimes(1);
  });

  it("sends a key that covers the summary (every room read) through it as well", () => {
    const client = { invalidateQueries: vi.fn() };
    const refetchSummary = vi.fn();
    invalidateLobbyKeys(client, [roomKeys.all], refetchSummary);
    expect(refetchSummary).toHaveBeenCalledTimes(1);
  });

  it("does not touch the summary for a change that doesn't affect it", () => {
    const client = { invalidateQueries: vi.fn() };
    const refetchSummary = vi.fn();
    invalidateLobbyKeys(client, [roomKeys.live()], refetchSummary);
    expect(refetchSummary).not.toHaveBeenCalled();
  });

  it("keeps the summary out of the immediate invalidation, which would refetch it uncoalesced", () => {
    const client = { invalidateQueries: vi.fn() };
    invalidateLobbyKeys(client, [roomKeys.all], vi.fn());
    const predicate = client.invalidateQueries.mock.calls[0]?.[0]?.predicate;
    expect(predicate({ queryKey: homeKeys.summary() })).toBe(false);
    expect(predicate({ queryKey: roomKeys.live() })).toBe(true);
    expect(predicate({ queryKey: roomKeys.past() })).toBe(true);
  });

  it("refetches the summary at most once per window across a burst of lobby changes", () => {
    vi.useFakeTimers();
    const refetchSummary = vi.fn();
    const coalesced = coalesce(refetchSummary, 5_000);
    const client = { invalidateQueries: vi.fn() };
    // 30 changes in a minute from one popular stream.
    for (let i = 0; i < 30; i++) {
      invalidateLobbyKeys(client, lobbyInvalidations(changed("count"), false), coalesced);
      vi.advanceTimersByTime(2_000);
    }
    expect(refetchSummary.mock.calls.length).toBeLessThanOrEqual(13);
    expect(refetchSummary.mock.calls.length).toBeLessThan(30);
  });
});
