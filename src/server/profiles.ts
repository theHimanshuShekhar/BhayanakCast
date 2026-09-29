/**
 * Profiles, server half (ADRs 11, 13). Each function takes the database and the
 * caller explicitly, so src/lib/profiles.functions.ts stays a thin wrapper and
 * tests call these directly against PGlite.
 *
 * Profiles are public (visitors may browse them) and carry no room data, so the
 * caller doesn't narrow anything yet. Stats come from the persistent aggregates:
 * `user_stats` (seconds, converted to hours here) and `user_cotime` (each pair
 * stored once with userA < userB, so a user may sit on either side).
 */
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { user, userCotime, userStats } from "../db/schema/index.ts";
import {
  type CoUser,
  PROFILE_CO_USERS,
  type Profile,
  type SearchUsersInput,
  searchUsersInput,
  secondsToHours,
  USER_SEARCH_LIMIT,
  type UserSearchResult,
} from "../lib/profiles.ts";
import type { Caller } from "./caller.ts";

/** The name a profile shows: the Discord username, else the display name. */
export const username = sql<string>`coalesce(${user.discordUsername}, ${user.name})`;

const statColumns = {
  secondsStreamed: userStats.secondsStreamed,
  secondsWatched: userStats.secondsWatched,
  roomsHosted: userStats.roomsHosted,
  roomsJoined: userStats.roomsJoined,
  peakViewers: userStats.peakViewers,
};

/** The profile of `userId`, or null if there's no such user. */
export async function getProfile(db: Db, _caller: Caller, userId: string): Promise<Profile | null> {
  const [row] = await db
    .select({
      id: user.id,
      username,
      displayName: user.name,
      createdAt: user.createdAt,
      ...statColumns,
    })
    .from(user)
    .leftJoin(userStats, eq(userStats.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    joinedAt: row.createdAt.toISOString(),
    stats: {
      hoursStreamed: secondsToHours(row.secondsStreamed ?? 0),
      hoursWatched: secondsToHours(row.secondsWatched ?? 0),
      roomsHosted: row.roomsHosted ?? 0,
      roomsJoined: row.roomsJoined ?? 0,
      peakViewers: row.peakViewers ?? 0,
    },
    coUsers: await topCoUsers(db, userId),
  };
}

/** `userId`'s top co-users by seconds together, most first (ties by id). */
async function topCoUsers(db: Db, userId: string): Promise<CoUser[]> {
  const other = sql`case when ${userCotime.userA} = ${userId} then ${userCotime.userB} else ${userCotime.userA} end`;
  return db
    .select({ id: user.id, username, secondsTogether: userCotime.secondsTogether })
    .from(userCotime)
    .innerJoin(user, eq(user.id, other))
    .where(
      and(
        or(eq(userCotime.userA, userId), eq(userCotime.userB, userId)),
        ne(userCotime.secondsTogether, 0),
      ),
    )
    .orderBy(desc(userCotime.secondsTogether), asc(user.id))
    .limit(PROFILE_CO_USERS);
}

/** `%` and `_` in a search term match themselves, not any characters. */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Users whose Discord username contains the query (case-insensitive), at most
 * `USER_SEARCH_LIMIT`: names starting with it first, then shortest, then A–Z.
 */
export async function searchUsers(
  db: Db,
  _caller: Caller,
  input: SearchUsersInput,
): Promise<UserSearchResult[]> {
  const { query } = searchUsersInput.parse(input);
  const rows = await db
    .select({
      id: user.id,
      username,
      displayName: user.name,
      secondsStreamed: userStats.secondsStreamed,
      secondsWatched: userStats.secondsWatched,
    })
    .from(user)
    .leftJoin(userStats, eq(userStats.userId, user.id))
    .where(sql`${username} ilike ${`%${escapeLike(query)}%`}`)
    .orderBy(
      sql`${username} ilike ${`${escapeLike(query)}%`} desc`,
      sql`length(${username})`,
      username,
      asc(user.id),
    )
    .limit(USER_SEARCH_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    stats: {
      hoursStreamed: secondsToHours(row.secondsStreamed ?? 0),
      hoursWatched: secondsToHours(row.secondsWatched ?? 0),
    },
  }));
}
