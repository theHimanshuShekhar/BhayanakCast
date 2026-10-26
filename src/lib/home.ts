/**
 * Home, client-safe half: the view the home-summary server function returns
 * (src/server/home.ts). No server-only imports.
 */
import type { CoUser } from "./profiles.ts";

/** Live counts over the rooms the caller may see ("Right Now"). */
export interface RightNow {
  liveRooms: number;
  /** People in those rooms (open presence intervals). */
  inRooms: number;
  /** People sharing their screen in those rooms (open stream intervals). */
  streaming: number;
}

/** Lifetime totals from the persistent stats (ADR 11, "Community"). */
export interface CommunityTotals {
  members: number;
  hoursWatched: number;
  hoursStreamed: number;
  roomsHosted: number;
}

/**
 * The home sidebar's numbers. The online count isn't here: it comes from the
 * realtime server (spec #3).
 */
export interface HomeSummary {
  rightNow: RightNow;
  community: CommunityTotals;
}

/**
 * The signed-in caller's own lifetime figures ("You"). Unlike a profile they count every room,
 * private ones included, because only their owner is ever sent them (ADR 16 addendum).
 */
export interface YouCard {
  hoursWatched: number;
  hoursStreamed: number;
  roomsJoined: number;
  /** Who they've spent the most time with, or null with no shared time yet. */
  topCoUser: CoUser | null;
}
