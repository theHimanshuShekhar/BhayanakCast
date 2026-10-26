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

/** How many people "Regulars" lists. */
export const REGULARS_LIMIT = 5;

/** Someone in "Regulars": their public-room hours, streamed plus watched. */
export interface Regular {
  id: string;
  username: string;
  image: string | null;
  hours: number;
}

/** A public past stream named by a record, which links to its recap. */
interface RecordRoom {
  id: string;
  name: string;
}

/**
 * The standout numbers ("Records"). Each is null with no data. They count public rooms only,
 * for every caller, admins included (ADR 16 addendum).
 */
export interface Records {
  /** Longest public past stream in the last 30 days, creation to end. */
  longestRoom: (RecordRoom & { durationMinutes: number }) | null;
  /** Public past stream in the last 30 days with the most people present at once. */
  biggestRoom: (RecordRoom & { people: number }) | null;
  /** The highest public peak viewers of any user, all time, rooms in progress included. */
  mostViewers: { streamer: Pick<Regular, "id" | "username" | "image">; viewers: number } | null;
}

/**
 * The home sidebar's numbers. The online count isn't here: it comes from the
 * realtime server (spec #3).
 */
export interface HomeSummary {
  rightNow: RightNow;
  /**
   * The top people by hours in public rooms (rooms in progress included), most first. The same
   * list for every caller, admins included: it names people, so private rooms stay out.
   */
  regulars: Regular[];
  /** Standout public-room numbers, the same for every caller like `regulars`. */
  records: Records;
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
