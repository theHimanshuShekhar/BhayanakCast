/**
 * Favorite query keys and options. The profile route's loader seeds
 * `isFavoriteQuery(userId)` for signed-in callers; the favorite button updates
 * it optimistically and invalidates it once the toggle settles. Answers depend
 * on the caller, so signing out drops them with every other query.
 */
import { queryOptions } from "@tanstack/react-query";
import { isFavoriteFn } from "./favorites.functions";

export const favoriteKeys = {
  all: ["favorites"] as const,
  detail: (userId: string) => [...favoriteKeys.all, "detail", userId] as const,
};

/** Whether the caller has favorited `userId` (false for visitors and yourself). */
export const isFavoriteQuery = (userId: string) =>
  queryOptions({
    queryKey: favoriteKeys.detail(userId),
    queryFn: () => isFavoriteFn({ data: { userId } }),
  });
