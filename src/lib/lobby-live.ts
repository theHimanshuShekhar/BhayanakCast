/**
 * The lobby channel on the page (ADR 20): every page keeps the realtime socket open, signed in
 * or not. `useLobbyLive(userId)` (mounted once, in the app shell) starts it, reconnects it when
 * the session changes so it upgrades to (or drops) authentication without a reload, keeps the
 * online-user count, and invalidates room reads when the lobby says rooms changed.
 * `useOnlineUsers()` reads the count anywhere.
 */
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { homeKeys } from "./home.queries";
import type { ServerMessage } from "./realtime";
import { getRealtimeClient } from "./realtime-client";
import { roomKeys } from "./rooms.queries";

/**
 * The query keys to invalidate for a lobby `message`: the live list and home summary when a
 * public room was created or its count changed, every room read when one ended (past lists
 * too), and every room read on a fresh snapshot after a reconnect (`reconnected`), since
 * anything may have changed while the socket was down.
 */
export function lobbyInvalidations(message: ServerMessage, reconnected: boolean): QueryKey[] {
  if (message.type === "lobby.snapshot") return reconnected ? [roomKeys.all] : [];
  if (message.type !== "lobby.changed" || !message.room) return [];
  if (message.room.change === "ended") return [roomKeys.all];
  return [roomKeys.live(), homeKeys.summary()];
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
  const unsubscribe = client.subscribe((message) => {
    if (message.type !== "lobby.snapshot" && message.type !== "lobby.changed") return;
    setOnline(message.online);
    const reconnected = message.type === "lobby.snapshot" && snapshots++ > 0;
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
