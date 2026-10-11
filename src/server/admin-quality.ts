/**
 * The admin's view of a room's video quality (ADR 2 and ADR 11 addendums). Like ./admin.ts,
 * every function takes the database and the caller explicitly and refuses anyone without the
 * admin role before reading anything; the /admin route guard is UX only. The samples are
 * reached by room id alone (they outlive the room, 90 days against its 30), and show who was on
 * each end of a pair by their user ids' names.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { qualitySamples, user } from "../db/schema/index.ts";
import {
  aggregatePairs,
  MAX_PAIR_SAMPLES,
  MAX_ROOM_SAMPLES,
  type PairTimeline,
  type PairTimelineInput,
  pairTimelineInput,
  type RoomQuality,
  timelineOf,
} from "../lib/quality-admin.ts";
import { type RoomPerson, roomIdInput } from "../lib/rooms.ts";
import { type Caller, requireAdmin } from "./caller.ts";
import { usernameOf } from "./rooms.ts";

/** The room's pairs, streamer to viewer, with how each did. */
export async function getRoomQuality(
  db: Db,
  caller: Caller,
  input: { roomId: string },
): Promise<RoomQuality> {
  requireAdmin(caller);
  const { roomId } = roomIdInput.parse(input);
  const rows = await db
    .select()
    .from(qualitySamples)
    .where(eq(qualitySamples.roomId, roomId))
    .orderBy(asc(qualitySamples.at))
    .limit(MAX_ROOM_SAMPLES + 1);
  const truncated = rows.length > MAX_ROOM_SAMPLES;
  const samples = truncated ? rows.slice(0, MAX_ROOM_SAMPLES) : rows;
  const pairs = aggregatePairs(samples);
  const people = await peopleByIds(
    db,
    pairs.flatMap((p) => [p.streamerId, p.viewerId]),
  );
  const named = (id: string): RoomPerson => people.get(id) ?? { id, username: id, image: null };
  return {
    roomKind: samples[0]?.roomKind ?? null,
    pairs: pairs
      .map((pair) => ({
        ...pair,
        streamer: named(pair.streamerId),
        viewer: named(pair.viewerId),
      }))
      .sort(
        (a, b) =>
          a.streamer.username.localeCompare(b.streamer.username) ||
          a.viewer.username.localeCompare(b.viewer.username) ||
          a.slot.localeCompare(b.slot),
      ),
    samples: samples.length,
    truncated,
  };
}

/**
 * One pair's session as series: what the sender sent and what the viewer got. Reads at most
 * `limit` rows, the first of the session, and says so (`truncated`) when there were more.
 */
export async function getPairTimeline(
  db: Db,
  caller: Caller,
  input: PairTimelineInput,
  limit: number = MAX_PAIR_SAMPLES,
): Promise<PairTimeline> {
  requireAdmin(caller);
  const { roomId, streamerId, viewerId, slot } = pairTimelineInput.parse(input);
  const rows = await db
    .select()
    .from(qualitySamples)
    .where(
      and(
        eq(qualitySamples.roomId, roomId),
        eq(qualitySamples.slot, slot),
        or(
          and(
            eq(qualitySamples.direction, "send"),
            eq(qualitySamples.reporterUserId, streamerId),
            eq(qualitySamples.peerUserId, viewerId),
          ),
          and(
            eq(qualitySamples.direction, "recv"),
            eq(qualitySamples.reporterUserId, viewerId),
            eq(qualitySamples.peerUserId, streamerId),
          ),
        ),
      ),
    )
    .orderBy(asc(qualitySamples.at))
    .limit(limit + 1);
  const truncated = rows.length > limit;
  return { ...timelineOf(truncated ? rows.slice(0, limit) : rows), truncated };
}

async function peopleByIds(db: Db, ids: string[]): Promise<Map<string, RoomPerson>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      discordUsername: user.discordUsername,
      image: user.image,
    })
    .from(user)
    .where(inArray(user.id, unique));
  return new Map(
    rows.map((row) => [row.id, { id: row.id, username: usernameOf(row), image: row.image }]),
  );
}
