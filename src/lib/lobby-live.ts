/**
 * The lobby channel on the page (ADR 20): every page keeps the realtime socket open, signed in
 * or not. `useLobbyLive(userId)` (mounted once, in the app shell) starts it, reconnects it when
 * the session changes so it upgrades to (or drops) authentication without a reload, keeps the
 * online-user count, and invalidates room reads when the lobby says rooms changed. A user an
 * admin bans is sent home with the ban notice.
 * `useOnlineUsers()` reads the count anywhere.
 */
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { banNoticeHref } from "./ban";
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
 */
export function lobbyInvalidations(message: ServerMessage, reconnected: boolean): QueryKey[] {
  if (message.type === "lobby.snapshot") return reconnected ? [roomKeys.all] : [];
  if (message.type !== "lobby.changed" || !message.room) return [];
  if (message.room.change === "ended") return [roomKeys.all, homeKeys.summary()];
  if (message.room.change === "thumbnail") return [roomKeys.live()];
  return [roomKeys.live(), homeKeys.summary()];
}

/** Thumbnail refetches are spaced at least this far apart: many streamers upload in step. */
const THUMBNAIL_REFETCH_MS = 5_000;

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

/** Online users (signed in, with an open socket); null until the socket's first snapshot. */
export function useOnlineUsers(): number | null {
  return useSyncExternalStore(
    subscribeOnline,
    () => online,
    () => null,
  );
}

function follow(queryClient: QueryClient): () => void {
  const client = getRealtimeClient();
  let snapshots = 0;
  const refetchCards = coalesce(
    () => void queryClient.invalidateQueries({ queryKey: roomKeys.live() }),
    THUMBNAIL_REFETCH_MS,
  );
  const unsubscribe = client.subscribe((message) => {
    if (message.type === "error" && message.code === "banned") {
      // An admin banned this user (ADR 6), which ended their session: load home afresh as a
      // visitor, with the ban notice, so nothing the page holds as them survives.
      window.location.assign(banNoticeHref(message.message));
      return;
    }
    if (message.type !== "lobby.snapshot" && message.type !== "lobby.changed") return;
    setOnline(message.online);
    const reconnected = message.type === "lobby.snapshot" && snapshots++ > 0;
    if (message.type === "lobby.changed" && message.room?.change === "thumbnail") {
      refetchCards();
      return;
    }
    for (const queryKey of lobbyInvalidations(message, reconnected)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  });
  client.start();
  return unsubscribe;
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
