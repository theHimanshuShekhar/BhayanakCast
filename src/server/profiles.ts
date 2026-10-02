/**
 * Profiles, server half (ADRs 11, 13). Each function takes the database and the
 * caller explicitly, so src/lib/profiles.functions.ts stays a thin wrapper and
 * tests call these directly against PGlite.
 *
 * Profiles are public (visitors may browse them). Stats come from the persistent aggregates
 * plus the rooms in progress (./stats.ts): `user_stats` (seconds, converted to hours
 * here) and `user_cotime` (each pair stored once with userA < userB, so a user may
 * sit on either side). They count public rooms only, so a profile never shows time or
 * company from a private room (ADR 16 addendum); admins see every room.
 */
import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { user } from "../db/schema/index.ts";
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
import { userCotimeVisibleTo, userStatsVisibleTo } from "./stats.ts";

/** The name a profile shows: the Discord username, else the display name. */
export const username = sql<string>`coalesce(${user.discordUsername}, ${user.name})`;

/** The profile of `userId` as `caller` may see it, or null if there's no such user. */
export async function getProfile(db: Db, caller: Caller, userId: string): Promise<Profile | null> {
  const stats = userStatsVisibleTo(caller);
  const [row] = await db
    .select({
      id: user.id,
      username,
      image: user.image,
      displayName: user.name,
      createdAt: user.createdAt,
      secondsStreamed: stats.secondsStreamed,
      secondsWatched: stats.secondsWatched,
      roomsHosted: stats.roomsHosted,
      roomsJoined: stats.roomsJoined,
      peakViewers: stats.peakViewers,
    })
    .from(user)
    .leftJoin(stats.from, eq(stats.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    image: row.image,
    displayName: row.displayName,
    joinedAt: row.createdAt.toISOString(),
    stats: {
      hoursStreamed: secondsToHours(row.secondsStreamed ?? 0),
      hoursWatched: secondsToHours(row.secondsWatched ?? 0),
      roomsHosted: row.roomsHosted ?? 0,
      roomsJoined: row.roomsJoined ?? 0,
      peakViewers: row.peakViewers ?? 0,
    },
    coUsers: await topCoUsers(db, caller, userId),
  };
}

/** `userId`'s top co-users by seconds together, most first (ties by id), as `caller` may see. */
async function topCoUsers(db: Db, caller: Caller, userId: string): Promise<CoUser[]> {
  const cotime = userCotimeVisibleTo(caller);
  const other = sql`case when ${cotime.userA} = ${userId} then ${cotime.userB} else ${cotime.userA} end`;
  return db
    .select({
      id: user.id,
      username,
      image: user.image,
      secondsTogether: cotime.secondsTogether,
    })
    .from(cotime.from)
    .innerJoin(user, eq(user.id, other))
    .where(
      and(or(eq(cotime.userA, userId), eq(cotime.userB, userId)), ne(cotime.secondsTogether, 0)),
    )
    .orderBy(desc(cotime.secondsTogether), asc(user.id))
    .limit(PROFILE_CO_USERS);
}

/** `%` and `_` in a search term match themselves, not any characters. */
export const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Users whose Discord username contains the query (case-insensitive), at most
 * `USER_SEARCH_LIMIT`: names starting with it first, then shortest, then A–Z. Their hours
 * are those of public rooms, as on a profile, unless `caller` is an admin.
 */
export async function searchUsers(
  db: Db,
  caller: Caller,
  input: SearchUsersInput,
): Promise<UserSearchResult[]> {
  const { query } = searchUsersInput.parse(input);
  const stats = userStatsVisibleTo(caller);
  const rows = await db
    .select({
      id: user.id,
      username,
      image: user.image,
      displayName: user.name,
      secondsStreamed: stats.secondsStreamed,
      secondsWatched: stats.secondsWatched,
    })
    .from(user)
    .leftJoin(stats.from, eq(stats.userId, user.id))
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
    image: row.image,
    displayName: row.displayName,
    stats: {
      hoursStreamed: secondsToHours(row.secondsStreamed ?? 0),
      hoursWatched: secondsToHours(row.secondsWatched ?? 0),
    },
  }));
}
