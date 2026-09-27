/**
 * Profiles, client-safe half: input schemas and the views the profile server
 * functions return (src/server/profiles.ts). Profiles are keyed by user id
 * (ADR 13 addendum); the page shows the current Discord username.
 */
import { z } from "zod";

/** How many co-users a profile lists (top by time together). */
export const PROFILE_CO_USERS = 5;
/** How many users a home search returns at most. */
export const USER_SEARCH_LIMIT = 8;
export const USER_SEARCH_QUERY_MAX = 64;

export const userIdInput = z.object({ userId: z.string().min(1).max(64) });

export const searchUsersInput = z.object({
  query: z.string().trim().min(1).max(USER_SEARCH_QUERY_MAX),
});
export type SearchUsersInput = z.input<typeof searchUsersInput>;

/** Lifetime stats (ADR 11), in hours for display. A user with no activity has all zeros. */
export interface ProfileStats {
  hoursStreamed: number;
  hoursWatched: number;
  roomsHosted: number;
  roomsJoined: number;
  peakViewers: number;
}

export interface CoUser {
  id: string;
  username: string;
  secondsTogether: number;
}

export interface Profile {
  id: string;
  /** Discord username (falls back to the display name if Discord never sent one). */
  username: string;
  /** Discord display name. */
  displayName: string;
  /** ISO timestamp of the account's creation. */
  joinedAt: string;
  stats: ProfileStats;
  /** Top co-users by time together, most first. */
  coUsers: CoUser[];
}

/** A home search result card. */
export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  stats: Pick<ProfileStats, "hoursStreamed" | "hoursWatched">;
}

const SECONDS_PER_HOUR = 3600;
export const secondsToHours = (seconds: number): number => seconds / SECONDS_PER_HOUR;

/** "Mar 2024". UTC so SSR and the browser agree. */
export const formatJoined = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
