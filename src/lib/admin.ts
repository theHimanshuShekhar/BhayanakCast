/**
 * Admin dashboard, client-safe half: the views the admin server functions return
 * (src/server/admin.ts). No server-only imports.
 */
import type { RoomPerson } from "./rooms";

/** The dashboard's rolling window, in UTC days ending today (ADR 11 keeps rooms this long). */
export const ADMIN_WINDOW_DAYS = 30;
/** Entries per leaderboard. */
export const LEADERBOARD_SIZE = 6;

/** A daily-counter total over the last window and the window before it. */
export interface WindowCount {
  current: number;
  previous: number;
}

/** The dashboard's stat cards. */
export interface AdminOverview {
  /** All-time, from the user table and the persistent per-user stats. */
  totals: {
    users: number;
    hoursStreamed: number;
    hoursWatched: number;
    roomsHosted: number;
    /** Rooms live now, private ones included. */
    liveRooms: number;
  };
  /** From the daily platform counters. */
  window: {
    newUsers: WindowCount;
    roomsCreated: WindowCount;
    roomsEnded: WindowCount;
  };
}

/** One UTC day of the platform counters; days without a counter row are zeros. */
export interface DailyPoint {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  newUsers: number;
  /** Users at the end of the day: today's total minus the sign-ups counted after it. */
  cumulativeUsers: number;
  roomsCreated: number;
  roomsEnded: number;
}

/** A row of the recent-rooms table: a live room or one ended within the window. */
export interface AdminRoomRow {
  id: string;
  name: string;
  isPrivate: boolean;
  host: RoomPerson | null;
  status: "live" | "ended";
  /** Most people present at once. */
  peak: number;
  /** Distinct people who were present at some point. */
  joined: number;
  /** From creation to end, or to now while live. */
  durationMinutes: number;
  /** ISO timestamps. */
  createdAt: string;
  endedAt: string | null;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  hours: number;
}

/** Top users by lifetime hours, most first. Users with no time aren't listed. */
export interface AdminLeaderboards {
  streamed: LeaderboardEntry[];
  watched: LeaderboardEntry[];
}

/**
 * Whole-percent change from `previous` to `current`, or null when there was nothing
 * before to compare with.
 */
export function percentChange({ current, previous }: WindowCount): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
