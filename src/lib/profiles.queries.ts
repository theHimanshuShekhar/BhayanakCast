/**
 * Profile query keys and options. The profile route's loader calls
 * `ensureQueryData(profileQuery(userId))`; home's user search reads
 * `searchUsersQuery(term)` with `useQuery`. Anything that changes stats or
 * usernames invalidates `profileKeys.all`.
 */
import { queryOptions } from "@tanstack/react-query";
import { getProfileFn, searchUsersFn } from "./profiles.functions";

export const profileKeys = {
  all: ["profiles"] as const,
  detail: (userId: string) => [...profileKeys.all, "detail", userId] as const,
  search: (query: string) => [...profileKeys.all, "search", query] as const,
};

/** A user's profile; `null` when there's no user with this id. */
export const profileQuery = (userId: string) =>
  queryOptions({
    queryKey: profileKeys.detail(userId),
    queryFn: () => getProfileFn({ data: { userId } }),
  });

/** Users whose Discord username contains `query` (already trimmed, non-empty). */
export const searchUsersQuery = (query: string) =>
  queryOptions({
    queryKey: profileKeys.search(query),
    queryFn: () => searchUsersFn({ data: { query } }),
  });
