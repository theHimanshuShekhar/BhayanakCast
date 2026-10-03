import { QueryClient, type QueryKey, QueryObserver } from "@tanstack/react-query";
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

  it("sends the live list and the home summary through their coalesced refetches, not at once", () => {
    const client = { invalidateQueries: vi.fn() };
    const refetchSummary = vi.fn();
    const refetchLive = vi.fn();
    invalidateLobbyKeys(client, [roomKeys.live(), homeKeys.summary()], refetchSummary, refetchLive);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    expect(refetchSummary).toHaveBeenCalledTimes(1);
    expect(refetchLive).toHaveBeenCalledTimes(1);
  });

  it("sends a key that covers the summary and the live list (every room read) through both as well", () => {
    const client = { invalidateQueries: vi.fn() };
    const refetchSummary = vi.fn();
    const refetchLive = vi.fn();
    invalidateLobbyKeys(client, [roomKeys.all], refetchSummary, refetchLive);
    expect(refetchSummary).toHaveBeenCalledTimes(1);
    expect(refetchLive).toHaveBeenCalledTimes(1);
  });

  it("does not touch the summary for a change that doesn't affect it", () => {
    const client = { invalidateQueries: vi.fn() };
    const refetchSummary = vi.fn();
    invalidateLobbyKeys(client, [roomKeys.live()], refetchSummary, vi.fn());
    expect(refetchSummary).not.toHaveBeenCalled();
  });

  it("keeps the coalesced reads out of the immediate invalidation, which would refetch them uncoalesced", () => {
    const client = { invalidateQueries: vi.fn() };
    invalidateLobbyKeys(client, [roomKeys.all], vi.fn(), vi.fn());
    const predicate = client.invalidateQueries.mock.calls[0]?.[0]?.predicate;
    expect(predicate({ queryKey: homeKeys.summary() })).toBe(false);
    expect(predicate({ queryKey: roomKeys.live() })).toBe(false);
    expect(predicate({ queryKey: roomKeys.past() })).toBe(true);
    expect(predicate({ queryKey: roomKeys.detail("r1") })).toBe(true);
  });

  it("refetches the summary at most once per window across a burst of lobby changes", () => {
    vi.useFakeTimers();
    const refetchSummary = vi.fn();
    const coalesced = coalesce(refetchSummary, 5_000);
    const client = { invalidateQueries: vi.fn() };
    // 30 changes in a minute from one popular stream.
    for (let i = 0; i < 30; i++) {
      invalidateLobbyKeys(client, lobbyInvalidations(changed("count"), false), coalesced, vi.fn());
      vi.advanceTimersByTime(2_000);
    }
    expect(refetchSummary.mock.calls.length).toBeLessThanOrEqual(13);
    expect(refetchSummary.mock.calls.length).toBeLessThan(30);
  });

  it("refetches the live list at most once per window across joins, leaves, renames and thumbnails", () => {
    vi.useFakeTimers();
    const refetchLive = vi.fn();
    const coalesced = coalesce(refetchLive, 5_000);
    const client = { invalidateQueries: vi.fn() };
    const changes = ["count", "renamed", "streamers", "thumbnail", "host", "created"] as const;
    // 30 changes in a minute, a mix of what a busy lobby sends.
    for (let i = 0; i < 30; i++) {
      const message = changed(changes[i % changes.length] ?? "count");
      invalidateLobbyKeys(client, lobbyInvalidations(message, false), vi.fn(), coalesced);
      vi.advanceTimersByTime(2_000);
    }
    expect(refetchLive.mock.calls.length).toBeLessThanOrEqual(13);
    expect(refetchLive.mock.calls.length).toBeLessThan(30);
    // Nothing reached the query client uncoalesced.
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it("fetches the live list and summary in step with the window, not once per lobby change", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const fetches = { live: 0, summary: 0 };
    const observe = (queryKey: QueryKey, count: keyof typeof fetches) =>
      new QueryObserver(queryClient, {
        queryKey,
        queryFn: async () => ++fetches[count],
        staleTime: Number.POSITIVE_INFINITY,
      }).subscribe(() => {});
    const unsubscribe = [observe(roomKeys.live(), "live"), observe(homeKeys.summary(), "summary")];
    await vi.advanceTimersByTimeAsync(10);
    expect(fetches).toEqual({ live: 1, summary: 1 });

    const refetchLive = coalesce(
      () => void queryClient.invalidateQueries({ queryKey: roomKeys.live() }),
      5_000,
    );
    const refetchSummary = coalesce(
      () => void queryClient.invalidateQueries({ queryKey: homeKeys.summary(), exact: true }),
      5_000,
    );
    const lobbyChanged = (change: Parameters<typeof changed>[0]) =>
      invalidateLobbyKeys(
        queryClient,
        lobbyInvalidations(changed(change), false),
        refetchSummary,
        refetchLive,
      );

    // The first change after a quiet spell is fetched at once.
    lobbyChanged("count");
    await vi.advanceTimersByTimeAsync(10);
    expect(fetches).toEqual({ live: 2, summary: 2 });

    // 30 more over a minute (a join, leave or rename every two seconds).
    const changes = ["count", "renamed", "streamers", "host", "created"] as const;
    for (let i = 0; i < 30; i++) {
      lobbyChanged(changes[i % changes.length] ?? "count");
      await vi.advanceTimersByTimeAsync(2_000);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    // One per 5 s window at most: 13 in the minute, not 30, and the same for the summary.
    expect(fetches.live - 2).toBeLessThanOrEqual(13);
    expect(fetches.summary - 2).toBeLessThanOrEqual(13);

    // A quiet lobby fetches nothing more.
    const settled = { ...fetches };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetches).toEqual(settled);
    for (const stop of unsubscribe) stop();
    queryClient.clear();
  });

  it("still invalidates the past lists and details at once when a room ended", () => {
    const client = { invalidateQueries: vi.fn() };
    invalidateLobbyKeys(client, lobbyInvalidations(changed("ended"), false), vi.fn(), vi.fn());
    expect(client.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(client.invalidateQueries.mock.calls[0]?.[0]?.queryKey).toEqual(roomKeys.all);
  });
});
