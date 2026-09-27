/**
 * Recap query keys and options (see rooms.queries.ts for how loaders and
 * components use them). Recaps are room data, so they live under `roomKeys.all`.
 */
import { queryOptions } from "@tanstack/react-query";
import { getRecapFn } from "./recaps.functions";
import { roomKeys } from "./rooms.queries";

export const recapKeys = {
  detail: (roomId: string) => [...roomKeys.all, "recap", roomId] as const,
};

/** An ended room's recap visible to the caller; `null` when unknown, live, expired or hidden. */
export const recapQuery = (roomId: string) =>
  queryOptions({
    queryKey: recapKeys.detail(roomId),
    queryFn: () => getRecapFn({ data: { roomId } }),
  });
