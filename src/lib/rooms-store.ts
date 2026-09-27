// In-memory room list for the UI until server functions exist (ADR 5/8).
import { useSyncExternalStore } from "react";
import { MAX_STREAMERS, ROOM_CAPACITY } from "./format";
import { LIVE_ROOMS } from "./mock-data";
import type { LiveRoom, RoomKind } from "./types";

let rooms: LiveRoom[] = LIVE_ROOMS;
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useLiveRooms = () =>
  useSyncExternalStore(
    subscribe,
    () => rooms,
    () => LIVE_ROOMS,
  );

export const findRoom = (id: string) => rooms.find((r) => r.id === id);

export type NewRoom = {
  name: string;
  description: string;
  kind: RoomKind;
  tags: string[];
  isPrivate: boolean;
};

/** Create a room hosted (and streamed) by `host`, the signed-in user. */
export const createRoom = (input: NewRoom, host: { id: string; username: string }): LiveRoom => {
  const room: LiveRoom = {
    id: `r${Date.now()}`,
    name: input.name,
    streamer: host.username,
    hostId: host.id,
    viewers: 1,
    capacity: ROOM_CAPACITY,
    tags: input.tags,
    kind: input.kind,
    started: "just now",
    members: [host.username],
    streams: [{ user: host.username, screen: "browser" as const }].slice(0, MAX_STREAMERS),
    isPrivate: input.isPrivate,
  };
  rooms = [room, ...rooms];
  for (const l of listeners) l();
  return room;
};
