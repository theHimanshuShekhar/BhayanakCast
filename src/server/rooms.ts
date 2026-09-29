/**
 * Rooms, server half (ADRs 2, 8, 16). Each function takes the database and the
 * caller explicitly, so the server functions in src/lib/rooms.functions.ts are
 * thin wrappers and tests call these directly against PGlite.
 *
 * Live = `ended_at is null`; past = ended within the last 30 days (ADR 11). Until the realtime server tracks people in memory
 * (spec #3), a live room's participants are its open presence intervals and its
 * streamers its open stream intervals.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  min,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  hostIntervals,
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  thumbnails,
  user,
} from "../db/schema/index.ts";
import { ROOM_CAPACITY } from "../lib/format.ts";
import {
  type CreateRoomInput,
  createRoomInput,
  type ListPastRoomsInput,
  type LiveRoomCard,
  listPastRoomsInput,
  type PastRoomCard,
  type RoomPerson,
  type RoomSummary,
} from "../lib/rooms.ts";
import { type Caller, requireSignedIn } from "./caller.ts";
import { announceRoom } from "./room-announcements.ts";
import { RETENTION_DAYS } from "./stats.ts";
import { roomVisibleTo } from "./visibility.ts";

const roomColumns = {
  id: rooms.id,
  name: rooms.name,
  description: rooms.description,
  kind: rooms.kind,
  tags: rooms.tags,
  isPrivate: rooms.isPrivate,
  createdAt: rooms.createdAt,
  endedAt: rooms.endedAt,
  hostId: user.id,
  hostName: user.name,
  hostDiscordUsername: user.discordUsername,
  hostImage: user.image,
};

/** Rooms with their host, the base of every room read. Add the WHERE per use. */
export function selectRooms(db: Db) {
  return db.select(roomColumns).from(rooms).leftJoin(user, eq(user.id, rooms.hostUserId));
}
export type RoomRow = Awaited<ReturnType<typeof selectRooms>>[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rooms that ended at most RETENTION_DAYS before `now`: the past streams and recaps
 * still kept (ADR 11). Older ones are about to be purged and count as gone.
 */
export function endedWithinRetention(now: Date): SQL | undefined {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  return and(isNotNull(rooms.endedAt), gte(rooms.endedAt, cutoff));
}

export function usernameOf(row: { name: string; discordUsername: string | null }): string {
  return row.discordUsername ?? row.name;
}

export function toSummary(row: RoomRow): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    tags: row.tags,
    isPrivate: row.isPrivate,
    host:
      row.hostId && row.hostName
        ? {
            id: row.hostId,
            username: usernameOf({ name: row.hostName, discordUsername: row.hostDiscordUsername }),
            image: row.hostImage,
          }
        : null,
    capacity: ROOM_CAPACITY,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Create a room hosted by the caller (a signed-in user) and return its id. The input is
 * validated here too, so every entry point gets the same rules, and the realtime server hears
 * of it (./room-announcements.ts) to tell the lobby. The host's `host_intervals`
 * row opens when they actually enter the room (spec #3), not here.
 */
export async function createRoom(
  db: Db,
  caller: Caller,
  input: CreateRoomInput,
): Promise<{ id: string }> {
  requireSignedIn(caller);
  const data = createRoomInput.parse(input);
  const hostId = caller.user.id;
  const room = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(rooms)
      .values({ ...data, createdBy: hostId, hostUserId: hostId })
      .returning({ id: rooms.id });
    if (!inserted) throw new Error("Room insert returned nothing");
    await tx.insert(roomMembers).values({ roomId: inserted.id, userId: hostId, role: "host" });
    return inserted;
  });
  // After the commit, so lists refetched on the lobby's word include the room.
  announceRoom({
    kind: "created",
    roomId: room.id,
    name: data.name,
    hostUserId: hostId,
    isPrivate: data.isPrivate,
  });
  return room;
}

/**
 * People with presence or stream intervals in `roomIds` (only open ones if `openOnly`),
 * once per room, by first start.
 */
async function peopleIn(
  db: Db,
  table: typeof presenceIntervals | typeof streamIntervals,
  roomIds: string[],
  { openOnly }: { openOnly: boolean },
): Promise<Map<string, RoomPerson[]>> {
  const byRoom = new Map<string, RoomPerson[]>();
  if (roomIds.length === 0) return byRoom;
  const firstStart = min(table.startedAt);
  const rows = await db
    .select({
      roomId: table.roomId,
      id: user.id,
      name: user.name,
      discordUsername: user.discordUsername,
      image: user.image,
    })
    .from(table)
    .innerJoin(user, eq(user.id, table.userId))
    .where(and(inArray(table.roomId, roomIds), openOnly ? isNull(table.endedAt) : undefined))
    .groupBy(table.roomId, user.id)
    .orderBy(asc(firstStart), asc(user.id));
  for (const row of rows) {
    const people = byRoom.get(row.roomId) ?? [];
    people.push({ id: row.id, username: usernameOf(row), image: row.image });
    byRoom.set(row.roomId, people);
  }
  return byRoom;
}

/** When each streamer's latest thumbnail was captured (ISO), keyed `roomId:userId`. */
export async function thumbnailTimes(db: Db, roomIds: string[]): Promise<Map<string, string>> {
  if (roomIds.length === 0) return new Map();
  const rows = await db
    .select({
      roomId: thumbnails.roomId,
      userId: thumbnails.userId,
      capturedAt: thumbnails.capturedAt,
    })
    .from(thumbnails)
    .where(inArray(thumbnails.roomId, roomIds));
  return new Map(rows.map((r) => [`${r.roomId}:${r.userId}`, r.capturedAt.toISOString()]));
}

/** `userId`'s thumbnail time in `roomId` from `thumbnailTimes`, or null if they have none. */
export const capturedAtOf = (captured: Map<string, string>, roomId: string, userId: string) =>
  captured.get(`${roomId}:${userId}`) ?? null;

/** Live room rows with the people in them now (open presence and stream intervals). */
async function withPeopleNow(db: Db, rows: RoomRow[]): Promise<LiveRoomCard[]> {
  const ids = rows.map((row) => row.id);
  const [present, streaming, captured] = await Promise.all([
    peopleIn(db, presenceIntervals, ids, { openOnly: true }),
    peopleIn(db, streamIntervals, ids, { openOnly: true }),
    thumbnailTimes(db, ids),
  ]);
  return rows.map((row) => {
    const participants = present.get(row.id) ?? [];
    const streamers = (streaming.get(row.id) ?? []).map((person) => ({
      ...person,
      thumbnailAt: capturedAtOf(captured, row.id, person.id),
    }));
    return {
      ...toSummary(row),
      participants,
      participantCount: participants.length,
      streamers,
      streamCount: streamers.length,
    };
  });
}

/** Live rooms the caller may see, newest first. */
export async function listLiveRooms(db: Db, caller: Caller): Promise<LiveRoomCard[]> {
  const rows = await selectRooms(db)
    .where(and(isNull(rooms.endedAt), roomVisibleTo(caller)))
    .orderBy(desc(rooms.createdAt), asc(rooms.id));
  return withPeopleNow(db, rows);
}

/**
 * A live room the caller may see, with the people in it now, or null if it's unknown,
 * ended or hidden from them.
 */
export async function getLiveRoom(
  db: Db,
  caller: Caller,
  roomId: string,
): Promise<LiveRoomCard | null> {
  const rows = await selectRooms(db).where(
    and(eq(rooms.id, roomId), isNull(rooms.endedAt), roomVisibleTo(caller)),
  );
  const [room] = await withPeopleNow(db, rows);
  return room ?? null;
}

/** Rooms `userId` hosted (at any point) or was present in. */
function involving(userId: string): SQL | undefined {
  return or(
    eq(rooms.hostUserId, userId),
    eq(rooms.createdBy, userId),
    sql`exists (
      select 1 from ${hostIntervals}
      where ${hostIntervals.roomId} = ${rooms.id} and ${hostIntervals.userId} = ${userId}
    )`,
    sql`exists (
      select 1 from ${presenceIntervals}
      where ${presenceIntervals.roomId} = ${rooms.id} and ${presenceIntervals.userId} = ${userId}
    )`,
  );
}

/**
 * Rooms the caller may see that ended within the last 30 days, most recently ended
 * first; with `userId`, only those that user hosted or joined.
 */
export async function listPastRooms(
  db: Db,
  caller: Caller,
  input: ListPastRoomsInput = {},
  now: Date = new Date(),
): Promise<PastRoomCard[]> {
  const { userId } = listPastRoomsInput.parse(input);
  const rows = await selectRooms(db)
    .where(
      and(endedWithinRetention(now), roomVisibleTo(caller), userId ? involving(userId) : undefined),
    )
    .orderBy(desc(rooms.endedAt), asc(rooms.id));
  const ids = rows.map((row) => row.id);
  const [present, streamed, captured] = await Promise.all([
    peopleIn(db, presenceIntervals, ids, { openOnly: false }),
    peopleIn(db, streamIntervals, ids, { openOnly: false }),
    thumbnailTimes(db, ids),
  ]);
  return rows.flatMap((row) => {
    if (!row.endedAt) return [];
    return [
      {
        ...toSummary(row),
        endedAt: row.endedAt.toISOString(),
        durationMinutes: minutesBetween(row.createdAt, row.endedAt),
        people: present.get(row.id) ?? [],
        streamers: (streamed.get(row.id) ?? []).map((person) => ({
          ...person,
          thumbnailAt: capturedAtOf(captured, row.id, person.id),
        })),
      },
    ];
  });
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime()) / 60_000;
}
