/**
 * Rooms, server half (ADRs 2, 8, 16). Each function takes the database and the
 * caller explicitly, so the server functions in src/lib/rooms.functions.ts are
 * thin wrappers and tests call these directly against PGlite.
 *
 * Live = `ended_at is null`. Until the realtime server tracks people in memory
 * (spec #3), a live room's participants are its open presence intervals and its
 * streamers its open stream intervals.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  presenceIntervals,
  roomMembers,
  rooms,
  streamIntervals,
  user,
} from "../db/schema/index.ts";
import { ROOM_CAPACITY } from "../lib/format.ts";
import {
  type CreateRoomInput,
  createRoomInput,
  type LiveRoomCard,
  type RoomPerson,
  type RoomSummary,
} from "../lib/rooms.ts";
import { type Caller, requireSignedIn } from "./caller.ts";
import { roomVisibleTo } from "./visibility.ts";

const roomColumns = {
  id: rooms.id,
  name: rooms.name,
  description: rooms.description,
  kind: rooms.kind,
  tags: rooms.tags,
  isPrivate: rooms.isPrivate,
  createdAt: rooms.createdAt,
  hostId: user.id,
  hostName: user.name,
  hostDiscordUsername: user.discordUsername,
};

/** Rooms with their host, the base of every room read. Add the WHERE per use. */
function selectRooms(db: Db) {
  return db.select(roomColumns).from(rooms).leftJoin(user, eq(user.id, rooms.hostUserId));
}
type RoomRow = Awaited<ReturnType<typeof selectRooms>>[number];

function usernameOf(row: { name: string; discordUsername: string | null }): string {
  return row.discordUsername ?? row.name;
}

function toSummary(row: RoomRow): RoomSummary {
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
          }
        : null,
    capacity: ROOM_CAPACITY,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Create a room hosted by the caller (a signed-in user) and return its id. The input is
 * validated here too, so every entry point gets the same rules. The host's `host_intervals`
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
  return db.transaction(async (tx) => {
    const [room] = await tx
      .insert(rooms)
      .values({ ...data, createdBy: hostId, hostUserId: hostId })
      .returning({ id: rooms.id });
    if (!room) throw new Error("Room insert returned nothing");
    await tx.insert(roomMembers).values({ roomId: room.id, userId: hostId, role: "host" });
    return room;
  });
}

/** Open presence or stream intervals of `roomIds`, as people per room, earliest first. */
async function openPeople(
  db: Db,
  table: typeof presenceIntervals | typeof streamIntervals,
  roomIds: string[],
): Promise<Map<string, RoomPerson[]>> {
  const byRoom = new Map<string, RoomPerson[]>();
  if (roomIds.length === 0) return byRoom;
  const rows = await db
    .select({
      roomId: table.roomId,
      id: user.id,
      name: user.name,
      discordUsername: user.discordUsername,
    })
    .from(table)
    .innerJoin(user, eq(user.id, table.userId))
    .where(and(inArray(table.roomId, roomIds), isNull(table.endedAt)))
    .orderBy(asc(table.startedAt));
  for (const row of rows) {
    const people = byRoom.get(row.roomId) ?? [];
    people.push({ id: row.id, username: usernameOf(row) });
    byRoom.set(row.roomId, people);
  }
  return byRoom;
}

/** Live rooms the caller may see, newest first. */
export async function listLiveRooms(db: Db, caller: Caller): Promise<LiveRoomCard[]> {
  const rows = await selectRooms(db)
    .where(and(isNull(rooms.endedAt), roomVisibleTo(caller)))
    .orderBy(desc(rooms.createdAt), asc(rooms.id));
  const ids = rows.map((row) => row.id);
  const [present, streaming] = await Promise.all([
    openPeople(db, presenceIntervals, ids),
    openPeople(db, streamIntervals, ids),
  ]);
  return rows.map((row) => {
    const participants = present.get(row.id) ?? [];
    const streamers = streaming.get(row.id) ?? [];
    return {
      ...toSummary(row),
      participants,
      participantCount: participants.length,
      streamers,
      streamCount: streamers.length,
    };
  });
}

/** A live room the caller may see, or null if it's unknown, ended or hidden from them. */
export async function getLiveRoom(
  db: Db,
  caller: Caller,
  roomId: string,
): Promise<RoomSummary | null> {
  const [row] = await selectRooms(db).where(
    and(eq(rooms.id, roomId), isNull(rooms.endedAt), roomVisibleTo(caller)),
  );
  return row ? toSummary(row) : null;
}
