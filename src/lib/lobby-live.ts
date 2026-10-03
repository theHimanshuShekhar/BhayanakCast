/**
 * The lobby channel on the page (ADR 20): every page keeps the realtime socket open, signed in
 * or not. `useLobbyLive(userId)` (mounted once, in the app shell) starts it, reconnects it when
 * the session changes so it upgrades to (or drops) authentication without a reload, keeps the
 * online count (users and visitors), and invalidates room reads when the lobby says rooms
 * changed. A user an admin bans is sent home with the ban notice.
 * `useOnlineCount()` reads the count anywhere.
 */
import { Debouncer } from "@tanstack/pacer";
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { banNoticeHref, markLeavingForBan } from "./ban";
import { homeKeys } from "./home.queries";
import type { ServerMessage } from "./realtime";
import { getRealtimeClient } from "./realtime-client";
import { roomKeys } from "./rooms.queries";

/**
 * The query keys to invalidate for a lobby `message`, by what changed in a public room:
 * - `created`, `count`, `streamers`, `renamed`, `host`: the live list and the home summary;
 * - `thumbnail`: the live list only (the summary has no images);
 * - `ended`: every room read (past lists too) and the home summary;
 * - a fresh snapshot after a reconnect (`reconnected`): every room read, since anything may have
 *   changed while the socket was down.
 * `invalidateLobbyKeys` then refetches the live list and the summary coalesced, not on every one.
 */
export function lobbyInvalidations(message: ServerMessage, reconnected: boolean): QueryKey[] {
  if (message.type === "lobby.snapshot") return reconnected ? [roomKeys.all] : [];
  if (message.type !== "lobby.changed" || !message.room) return [];
  if (message.room.change === "ended") return [roomKeys.all, homeKeys.summary()];
  if (message.room.change === "thumbnail") return [roomKeys.live()];
  return [roomKeys.live(), homeKeys.summary()];
}

/**
 * Live room list refetches are spaced at least this far apart: many streamers upload in step,
 * and on a busy lobby every join, leave and rename would otherwise refetch the list for every
 * home viewer.
 */
const LIVE_LIST_REFETCH_MS = 5_000;

/**
 * Home summary refetches are spaced at least this far apart: a busy lobby changes many times a
 * minute, and the summary is rate-limited per IP (ADR 20 addendum), so a few tabs refetching
 * on every change would use up the budget. At most 12 a minute per tab.
 */
const SUMMARY_REFETCH_MS = 5_000;

/**
 * Wrap `run` so a burst of calls runs it at once, then at most once per `ms`: calls during the
 * wait collapse into one run when it ends.
 */
export function coalesce(run: () => void, ms: number): () => void {
  let waiting = false;
  let pending = false;
  const wait = () => {
    waiting = true;
    setTimeout(() => {
      waiting = false;
      if (!pending) return;
      pending = false;
      run();
      wait();
    }, ms);
  };
  return () => {
    if (waiting) {
      pending = true;
      return;
    }
    run();
    wait();
  };
}

/** Whether `key` starts with `prefix`, as a query key matches the keys under it. */
const startsWith = (key: QueryKey, prefix: QueryKey) =>
  prefix.length <= key.length && prefix.every((part, i) => part === key[i]);

/**
 * Invalidate `keys` (from `lobbyInvalidations`), but leave the home summary to `refetchSummary`
 * and the live room list to `refetchLive`, `coalesce`d refetches of them, wherever a key covers
 * them (`roomKeys.all` does). Every other read (past lists, a room's detail) is invalidated at
 * once.
 */
export function invalidateLobbyKeys(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  keys: QueryKey[],
  refetchSummary: () => void,
  refetchLive: () => void,
): void {
  const summary = homeKeys.summary();
  const live = roomKeys.live();
  for (const queryKey of keys) {
    if (startsWith(summary, queryKey)) refetchSummary();
    if (startsWith(live, queryKey)) refetchLive();
    // A coalesced read's own key has nothing else to invalidate.
    if (startsWith(queryKey, summary) || startsWith(queryKey, live)) continue;
    void queryClient.invalidateQueries({
      queryKey,
      predicate: ({ queryKey: read }) => !startsWith(read, summary) && !startsWith(read, live),
    });
  }
}

// The online count, shared by every component that shows it. Browser-only state: the server
// render has no socket and shows "not known yet".
let online: number | null = null;
const onlineListeners = new Set<() => void>();

function setOnline(value: number): void {
  if (value === online) return;
  online = value;
  for (const listener of onlineListeners) listener();
}

function subscribeOnline(listener: () => void): () => void {
  onlineListeners.add(listener);
  return () => onlineListeners.delete(listener);
}

/** The online count (CONTEXT.md); null until the socket's first snapshot. */
export function useOnlineCount(): number | null {
  return useSyncExternalStore(
    subscribeOnline,
    () => online,
    () => null,
  );
}

/**
 * A `lobby.changed` count shows only once it has held this long: a visitor who signs in or out
 * closes one socket and opens another, and the server's count dips by one in between.
 */
export const ONLINE_SETTLE_MS = 3_000;

/** `ONLINE_SETTLE_MS`, unless the build sets `VITE_ONLINE_SETTLE_MS` (the e2e build does). */
const pageSettleMs = Number(import.meta.env.VITE_ONLINE_SETTLE_MS ?? ONLINE_SETTLE_MS);

/**
 * Feeds the online count to `apply`: a snapshot at once (the first paint and every reconnect),
 * a `lobby.changed` count after it has held for `ONLINE_SETTLE_MS`, so N, N-1, N never shows.
 * `cancel()` drops a pending count, on teardown.
 */
export function settleOnline(apply: (online: number) => void, settleMs = ONLINE_SETTLE_MS) {
  const settle = new Debouncer(apply, { wait: settleMs });
  return {
    snapshot(online: number): void {
      settle.cancel();
      apply(online);
    },
    changed: (online: number): void => settle.maybeExecute(online),
    cancel: (): void => settle.cancel(),
  };
}

function follow(queryClient: QueryClient): () => void {
  const client = getRealtimeClient();
  const onlineCount = settleOnline(
    setOnline,
    Number.isFinite(pageSettleMs) ? pageSettleMs : undefined,
  );
  let snapshots = 0;
  const refetchLive = coalesce(
    () => void queryClient.invalidateQueries({ queryKey: roomKeys.live() }),
    LIVE_LIST_REFETCH_MS,
  );
  const refetchSummary = coalesce(
    () => void queryClient.invalidateQueries({ queryKey: homeKeys.summary(), exact: true }),
    SUMMARY_REFETCH_MS,
  );
  const unsubscribe = client.subscribe((message) => {
    if (message.type === "error" && message.code === "banned") {
      // An admin banned this user (ADR 6), which ended their session: load home afresh as a
      // visitor, with the ban notice, so nothing the page holds as them survives.
      markLeavingForBan();
      window.location.assign(banNoticeHref(message.message));
      return;
    }
    if (message.type !== "lobby.snapshot" && message.type !== "lobby.changed") return;
    if (message.type === "lobby.snapshot") onlineCount.snapshot(message.online);
    else onlineCount.changed(message.online);
    const reconnected = message.type === "lobby.snapshot" && snapshots++ > 0;
    invalidateLobbyKeys(
      queryClient,
      lobbyInvalidations(message, reconnected),
      refetchSummary,
      refetchLive,
    );
  });
  client.start();
  return () => {
    unsubscribe();
    onlineCount.cancel();
  };
}

/**
 * Keep the page's socket open and follow the lobby. `userId` is the signed-in user's id (null
 * for a visitor): when it changes the socket reconnects, so it carries the new session.
 */
export function useLobbyLive(userId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => follow(queryClient), [queryClient]);

  const connectedAs = useRef(userId);
  useEffect(() => {
    if (connectedAs.current === userId) return;
    connectedAs.current = userId;
    getRealtimeClient().restart();
  }, [userId]);
}
