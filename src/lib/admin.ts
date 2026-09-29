/**
 * Admin dashboard, client-safe half: the views the admin server functions return
 * (src/server/admin.ts). No server-only imports.
 */
import { z } from "zod";
import { userIdInput } from "./profiles.ts";
import { type RoomPerson, roomIdInput } from "./rooms.ts";

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

// ---------------------------------------------------------------------------------------------
// Users table, bans, admin roles (spec #7)

/** Rows per page of the users table. */
export const ADMIN_USERS_PAGE_SIZE = 25;
export const ADMIN_USERS_QUERY_MAX = 64;
export const BAN_REASON_MAX = 200;

/** A page of the users table: `q` matches usernames; `banned` keeps only users banned now. */
export const listAdminUsersInput = z.object({
  q: z.string().trim().max(ADMIN_USERS_QUERY_MAX).default(""),
  banned: z.boolean().default(false),
  page: z.number().int().min(1).max(100_000).default(1),
});
export type ListAdminUsersInput = z.input<typeof listAdminUsersInput>;

/** A ban in force. */
export interface AdminBan {
  reason: string | null;
  /** ISO timestamp; null for a permanent ban. */
  expiresAt: string | null;
}

/** A user's site-wide role. */
export type AdminRole = "admin" | "user";

/** The site-wide role a stored `user.role` stands for: anything but `admin` is a plain user. */
export const toAdminRole = (role: string | null | undefined): AdminRole =>
  role === "admin" ? "admin" : "user";

export interface AdminUserRow {
  id: string;
  username: string;
  /** ISO timestamp of sign-up. */
  joinedAt: string;
  role: AdminRole;
  /**
   * An admin listed in `ADMIN_DISCORD_IDS` (ADR 6 addendum), which re-grants the role at every
   * sign-in: they can't be demoted.
   */
  envAdmin: boolean;
  /** Null unless banned now (an expired ban no longer counts). */
  ban: AdminBan | null;
  /** When they were last in a room (ISO), from presence; null if not within the 30 days kept. */
  lastSeenAt: string | null;
  /** Lifetime hours in rooms: streamed plus watched. */
  hours: number;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  /** Users matching the search, across all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/** How long a ban lasts, in seconds; null for good. */
export const BAN_DURATIONS = {
  "1d": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  permanent: null,
} as const satisfies Record<string, number | null>;
export type BanDuration = keyof typeof BAN_DURATIONS;

export const banUserInput = userIdInput.extend({
  reason: z.string().trim().min(1, "Give a reason").max(BAN_REASON_MAX),
  duration: z.enum(Object.keys(BAN_DURATIONS) as [BanDuration, ...BanDuration[]]),
});
export type BanUserInput = z.input<typeof banUserInput>;

export const unbanUserInput = userIdInput;
export type UnbanUserInput = z.input<typeof unbanUserInput>;

/** Promote a user to admin (`role: "admin"`) or demote an admin (`role: "user"`). */
export const setUserRoleInput = userIdInput.extend({ role: z.enum(["admin", "user"]) });
export type SetUserRoleInput = z.input<typeof setUserRoleInput>;

// ---------------------------------------------------------------------------------------------
// Ending rooms (spec #7)

/** End a live room now. */
export const endRoomInput = roomIdInput;
export type EndRoomInput = z.input<typeof endRoomInput>;
