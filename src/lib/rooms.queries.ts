/**
 * Room query keys and options. Route loaders call
 * `context.queryClient.ensureQueryData(<options>)` so SSR and client navigation
 * start with data; components read the same options with `useSuspenseQuery`.
 * Anything that changes rooms (a mutation now, socket events in spec #3)
 * invalidates by these keys: `roomKeys.all` refreshes every room read.
 */
import { queryOptions } from "@tanstack/react-query";
import { getLiveRoomFn, listLiveRoomsFn, listPastRoomsFn } from "./rooms.functions";

export const roomKeys = {
  all: ["rooms"] as const,
  live: () => [...roomKeys.all, "live"] as const,
  /** Every past-rooms list; with `userId`, that profile's recent streams. */
  past: (userId?: string) => [...roomKeys.all, "past", ...(userId ? [userId] : [])] as const,
  detail: (roomId: string) => [...roomKeys.all, "detail", roomId] as const,
};

export const liveRoomsQuery = () =>
  queryOptions({ queryKey: roomKeys.live(), queryFn: () => listLiveRoomsFn() });

/** A live room visible to the caller; `null` when unknown, ended or hidden. */
export const roomQuery = (roomId: string) =>
  queryOptions({
    queryKey: roomKeys.detail(roomId),
    queryFn: () => getLiveRoomFn({ data: { roomId } }),
  });

/** Rooms ended within 30 days, visible to the caller; with `userId`, those they hosted or joined. */
export const pastRoomsQuery = (userId?: string) =>
  queryOptions({
    queryKey: roomKeys.past(userId),
    queryFn: () => listPastRoomsFn({ data: userId ? { userId } : {} }),
  });
