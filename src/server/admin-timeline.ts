/**
 * The admin's view of a room's timeline (CONTEXT.md; ADR 11 addendum). Like
 * ./admin.ts, it takes the database and the caller explicitly and refuses anyone without the
 * admin role before reading anything; the /admin route guard is UX only.
 *
 * Several stores are merged at read time, by room id alone, since none of them has a foreign key
 * to the room that would survive its purge: the stored events (./room-timeline.ts, kept 90 days),
 * the quality samples' step changes (90 days), and the presence, stream and host intervals,
 * which are room data and only reach back 30 days. Each is read newest first up to the size
 * bound, so the merged list's latest `limit` entries are exact: what a diagnosis wants is the
 * recent end, and `truncated` says older entries were left out.
 */
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  hostIntervals,
  presenceIntervals,
  qualitySamples,
  roomTimelineEvents,
  streamIntervals,
} from "../db/schema/index.ts";
import {
  MAX_TIMELINE_ENTRIES,
  type RoomTimeline,
  type RoomTimelineEntry,
  TIMELINE_INTERVAL_DAYS,
} from "../lib/room-timeline.ts";
import { roomIdInput } from "../lib/rooms.ts";
import { peopleByIds } from "./admin-quality.ts";
import { type Caller, requireAdmin } from "./caller.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RoomTimelineOptions {
  /** Where "30 days back" is counted from. Defaults to now. */
  now?: Date;
  /** The most entries to return. Defaults to `MAX_TIMELINE_ENTRIES`. */
  limit?: number;
}

/** Entries that share a time sort in this order (events keep the order they were recorded in). */
const SOURCE_ORDER: Record<RoomTimelineEntry["source"], number> = {
  event: 0,
  host: 1,
  presence: 2,
  stream: 3,
  quality: 4,
};

/** A room's merged timeline, oldest first, cut to the latest `limit` entries (`truncated` says older ones were left out). */
export async function getRoomTimeline(
  db: Db,
  caller: Caller,
  input: { roomId: string },
  { now = new Date(), limit = MAX_TIMELINE_ENTRIES }: RoomTimelineOptions = {},
): Promise<RoomTimeline> {
  requireAdmin(caller);
  const { roomId } = roomIdInput.parse(input);
  const since = new Date(now.getTime() - TIMELINE_INTERVAL_DAYS * DAY_MS);
  // One more than `limit` from each, so a cut shows even when one source alone passes it.
  const take = limit + 1;

  // Newest first, each cut at `take`; put back in time order below.
  const [events, steps, presence, streams, hosts] = await Promise.all([
    db
      .select()
      .from(roomTimelineEvents)
      .where(eq(roomTimelineEvents.roomId, roomId))
      .orderBy(desc(roomTimelineEvents.at), desc(roomTimelineEvents.id))
      .limit(take),
    db
      .select()
      .from(qualitySamples)
      .where(and(eq(qualitySamples.roomId, roomId), eq(qualitySamples.trigger, "rung")))
      .orderBy(desc(qualitySamples.at))
      .limit(take),
    db
      .select()
      .from(presenceIntervals)
      .where(and(eq(presenceIntervals.roomId, roomId), endedSince(presenceIntervals, since)))
      .orderBy(desc(presenceIntervals.startedAt))
      .limit(take),
    db
      .select()
      .from(streamIntervals)
      .where(and(eq(streamIntervals.roomId, roomId), endedSince(streamIntervals, since)))
      .orderBy(desc(streamIntervals.startedAt))
      .limit(take),
    db
      .select()
      .from(hostIntervals)
      .where(
        and(
          eq(hostIntervals.roomId, roomId),
          or(isNull(hostIntervals.endedAt), gte(hostIntervals.endedAt, since)),
        ),
      )
      .orderBy(desc(hostIntervals.startedAt))
      .limit(take),
  ]);

  const merged: { at: Date; entry: RoomTimelineEntry }[] = [
    ...events.reverse().map((e) => ({
      at: e.at,
      entry: {
        source: "event" as const,
        at: e.at.toISOString(),
        kind: e.kind,
        actorUserId: e.actorUserId,
        targetUserId: e.targetUserId,
        details: e.details,
      },
    })),
    ...hosts.reverse().map((i) => interval("host", i.userId, i.startedAt, i.endedAt)),
    ...presence.reverse().map((i) => interval("presence", i.userId, i.startedAt, i.endedAt)),
    ...streams.reverse().map((i) => interval("stream", i.userId, i.startedAt, i.endedAt)),
    ...steps.reverse().map((s) => ({
      at: s.at,
      entry: {
        source: "quality" as const,
        at: s.at.toISOString(),
        reporterUserId: s.reporterUserId,
        peerUserId: s.peerUserId,
        direction: s.direction,
        slot: s.slot,
        rung: s.rung,
        toRung: s.toRung,
        reason: s.rungReason,
      },
    })),
  ];
  // Stable, so events recorded in the same millisecond stay in the order they happened.
  merged.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      SOURCE_ORDER[a.entry.source] - SOURCE_ORDER[b.entry.source],
  );
  const truncated = merged.length > limit;
  const entries = merged.slice(-limit).map((m) => m.entry);

  const ids = [
    ...new Set(
      entries
        .flatMap((e) =>
          e.source === "event"
            ? [e.actorUserId, e.targetUserId]
            : e.source === "quality"
              ? [e.reporterUserId, e.peerUserId]
              : [e.userId],
        )
        .filter((id): id is string => id !== null),
    ),
  ];
  const found = await peopleByIds(db, ids);
  // An account that has since been deleted stays in the timeline by its id.
  const people = Object.fromEntries(
    ids.map((id) => [id, found.get(id) ?? { id, username: id, image: null }]),
  );
  return { entries, people, truncated };
}

/**
 * An interval that ended, or was last seen, at `since` or later. On the typed columns, not a
 * `coalesce`: a parameter compared with raw SQL skips the column's encoding, and postgres-js
 * (production; PGlite tolerates it) refuses the bare `Date`.
 */
function endedSince(table: typeof presenceIntervals | typeof streamIntervals, since: Date) {
  return or(gte(table.endedAt, since), and(isNull(table.endedAt), gte(table.lastSeenAt, since)));
}

function interval(
  source: "presence" | "stream" | "host",
  userId: string,
  startedAt: Date,
  endedAt: Date | null,
): { at: Date; entry: RoomTimelineEntry } {
  return {
    at: startedAt,
    entry: {
      source,
      at: startedAt.toISOString(),
      userId,
      endedAt: endedAt?.toISOString() ?? null,
    },
  };
}
