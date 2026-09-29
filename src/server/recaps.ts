/**
 * Recaps, server half (ADRs 11, 12, 16): an ended room's timeline built from its
 * presence and stream intervals. The intervals are clamped and merged by the same
 * SQL the stats roll-up uses (./intervals.ts), so a recap's minutes are exactly
 * what the room added to everyone's stats.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { rooms } from "../db/schema/index.ts";
import type { Recap, RecapPerson } from "../lib/recaps.ts";
import type { Caller } from "./caller.ts";
import { roomTimes } from "./intervals.ts";
import {
  capturedAtOf,
  endedWithinRetention,
  minutesBetween,
  selectRooms,
  thumbnailTimes,
  toSummary,
  usernameOf,
} from "./rooms.ts";
import { roomVisibleTo } from "./visibility.ts";

/** One merged span per row, with its user's totals repeated on each of their rows. */
function recapSpans(db: Db, roomId: string) {
  const spans = sql`(
    with ${roomTimes(roomId)},
    spans as (
      select 'presence' as kind, user_id, s, e from p
      union all
      select 'stream' as kind, user_id, s, e from st
    )
    select sp.kind, sp.user_id, sp.s, sp.e, u.name, u.discord_username, u.image,
           coalesce(pr.secs, 0) as present_secs,
           coalesce(sd.secs, 0) as streamed_secs,
           coalesce(w.secs, 0) as watched_secs
    from spans sp
    join "user" u on u.id = sp.user_id
    left join present pr on pr.user_id = sp.user_id
    left join streamed sd on sd.user_id = sp.user_id
    left join watched w on w.user_id = sp.user_id
  ) as recap`;
  const epochMs = (column: string) =>
    sql<number>`extract(epoch from ${sql.raw(`recap.${column}`)})::float8 * 1000`.mapWith(Number);
  return db
    .select({
      kind: sql<"presence" | "stream">`recap.kind`,
      userId: sql<string>`recap.user_id`,
      name: sql<string>`recap.name`,
      discordUsername: sql<string | null>`recap.discord_username`,
      image: sql<string | null>`recap.image`,
      startMs: epochMs("s"),
      endMs: epochMs("e"),
      presentSecs: sql<number>`recap.present_secs`.mapWith(Number),
      streamedSecs: sql<number>`recap.streamed_secs`.mapWith(Number),
      watchedSecs: sql<number>`recap.watched_secs`.mapWith(Number),
    })
    .from(spans)
    .orderBy(sql`recap.s`, sql`recap.e`, sql`recap.user_id`);
}

/**
 * The recap of an ended room the caller may see, or null if it's unknown, still live,
 * older than 30 days or private to them.
 */
export async function getRecap(
  db: Db,
  caller: Caller,
  roomId: string,
  now: Date = new Date(),
): Promise<Recap | null> {
  const [room] = await selectRooms(db).where(
    and(eq(rooms.id, roomId), endedWithinRetention(now), roomVisibleTo(caller)),
  );
  if (!room?.endedAt) return null;

  const captured = await thumbnailTimes(db, [roomId]);
  const byUser = new Map<string, RecapPerson & { firstMs: number }>();
  for (const row of await recapSpans(db, roomId)) {
    let person = byUser.get(row.userId);
    if (!person) {
      person = {
        id: row.userId,
        username: usernameOf(row),
        image: row.image,
        isHost: row.userId === room.hostId,
        presence: [],
        presenceMinutes: row.presentSecs / 60,
        streams: [],
        streamMinutes: row.streamedSecs / 60,
        watchMinutes: row.watchedSecs / 60,
        thumbnailAt: capturedAtOf(captured, roomId, row.userId),
        firstMs: row.startMs,
      };
      byUser.set(row.userId, person);
    }
    const span = {
      start: new Date(row.startMs).toISOString(),
      end: new Date(row.endMs).toISOString(),
    };
    (row.kind === "presence" ? person.presence : person.streams).push(span);
  }

  const people = [...byUser.values()]
    .sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.firstMs - b.firstMs)
    .map(({ firstMs: _, ...person }) => person);
  return {
    ...toSummary(room),
    endedAt: room.endedAt.toISOString(),
    durationMinutes: minutesBetween(room.createdAt, room.endedAt),
    people,
    totalWatchMinutes: people.reduce((sum, person) => sum + person.watchMinutes, 0),
  };
}
