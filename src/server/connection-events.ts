/**
 * Connection events (ADR 3 addendum on the room timeline, ADR 11 addendum), server half: what a
 * page reports about its own connections (`reportConnectionFn`, or the beacon route when the
 * page closes) becomes rows of the room timeline (./room-timeline.ts), with real user ids: the
 * reporter as actor, the peer of a pair as target.
 *
 * A report is taken from a signed-in caller, and each event is judged on its own:
 * - An event about a pair (anything with a `peerId`) needs the caller in the live room and the
 *   peer in it too; a peer who left since, or the caller themselves, is dropped.
 * - A device error (`device_error`) needs the caller in the live room, or, for the pre-join, to
 *   be allowed to enter it (`mayEnterRoom`, the rule the realtime server applies on a join).
 * Events are dated by this server's clock (ADR 12) from the age the page gave, clamped to
 * `MAX_EVENT_AGE_MS`, so a page with a wrong clock can't put rows in the wrong place.
 *
 * Bounded three ways. A report holds at most `CONNECTION_BATCH_MAX` events (checked again here,
 * as a server function's validator isn't the only way in). A person may send only so many reports
 * in a while (`CONNECTION_BATCH_RATE_LIMIT`): one over it is refused whole. And at most
 * `CONNECTION_EVENT_CAP` of their events are stored in a while, across rooms; the rest are
 * dropped, and one `events_dropped` row says how many (`details.count`), so the gap stays
 * visible. The marker is written once the run of drops has gone quiet (`DROP_MARKER_DELAY_MS`),
 * so it holds the final count; one waiting when the server stops is lost.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { type Db, getDb } from "../db/client.ts";
import { presenceIntervals, rooms, roomTimelineEvents } from "../db/schema/index.ts";
import {
  type ConnectionEventInput,
  MAX_EVENT_AGE_MS,
  type ReportConnectionEventsInput,
  reportConnectionEventsInput,
} from "../lib/connection-events.ts";
import { boundDetails, type TimelineEventRow } from "../lib/room-timeline.ts";
import { type Caller, requireSignedIn, type SignedInCaller } from "./caller.ts";
import { type Clock, systemClock, type Timer } from "./clock.ts";
import { mayEnterRoom } from "./ice.ts";
import { logReportDropped, logTimelineEvent, logTimelineWriteFailed } from "./log-events.ts";
import { forgetIdle, withinRateLimit } from "./rate-limit.ts";
import { readBodyCapped } from "./thumbnails.ts";

/**
 * Events stored per person in any `windowMs`. A pair that flaps is a few events a second, so a
 * cap is what keeps one bad connection from filling the table; two minutes of it fit.
 */
export const CONNECTION_EVENT_CAP = { events: 120, windowMs: 10 * 60_000 } as const;
/**
 * Reports per person in any `windowMs`; one over it is dropped whole. A page sends one every few
 * seconds at the very most, and events only come in bursts.
 */
export const CONNECTION_BATCH_RATE_LIMIT = { batches: 100, windowMs: 10 * 60_000 } as const;
/** A run of capped drops is written as one marker once none has come for this long. */
export const DROP_MARKER_DELAY_MS = 60_000;

/** What a report came to. */
export interface ConnectionReportResult {
  /** Events stored. */
  stored: number;
  /** Events that passed every check but were over the person's cap. */
  dropped: number;
}

export interface ConnectionEventServiceOptions {
  db: Db;
  clock?: Clock;
  /** Whether a signed-in caller may enter the live room (`mayEnterRoom`). */
  mayEnter?: (caller: SignedInCaller, roomId: string) => Promise<boolean>;
}

/** One person's drops that no marker has recorded yet. */
interface PendingMarker {
  roomId: string;
  /** When the first of them was dropped: where the gap begins. */
  from: Date;
  count: number;
  timer: Timer;
}

export class ConnectionEventService {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #mayEnter: NonNullable<ConnectionEventServiceOptions["mayEnter"]>;
  /** When each person's reports arrived (epoch ms, oldest first). */
  readonly #batches = new Map<string, number[]>();
  /** When each person's stored events were reported (epoch ms, oldest first, one per event). */
  readonly #stored = new Map<string, number[]>();
  readonly #markers = new Map<string, PendingMarker>();
  readonly #writes = new Set<Promise<void>>();

  constructor(options: ConnectionEventServiceOptions) {
    this.#db = options.db;
    this.#clock = options.clock ?? systemClock;
    this.#mayEnter =
      options.mayEnter ?? ((caller, roomId) => mayEnterRoom(this.#db, caller, roomId));
  }

  /**
   * Store the events of `input` from the signed-in `caller`. Nothing is stored for events the
   * caller may not report (see above), or from a caller over the report rate limit.
   */
  async record(
    caller: Caller,
    input: ReportConnectionEventsInput,
  ): Promise<ConnectionReportResult> {
    requireSignedIn(caller);
    const reporter = caller.user.id;
    const parsed = reportConnectionEventsInput.safeParse(input);
    if (!parsed.success) {
      const named = (input as { roomId?: unknown } | null)?.roomId;
      logReportDropped("connection_event", "invalid", {
        userId: reporter,
        roomId: typeof named === "string" ? named : undefined,
      });
      throw parsed.error;
    }
    const { roomId, events } = parsed.data;
    const now = this.#clock.now();
    const batches = CONNECTION_BATCH_RATE_LIMIT;
    forgetIdle(this.#batches, batches.windowMs, now);
    if (!withinRateLimit(this.#batches, reporter, batches.batches, batches.windowMs, now)) {
      logReportDropped("connection_event", "over_limit", {
        userId: reporter,
        roomId,
        events: events.length,
      });
      return { stored: 0, dropped: 0 };
    }

    const peers = new Set(
      events.flatMap((e) => ("peerId" in e && e.peerId !== reporter ? [e.peerId] : [])),
    );
    // Who is in the live room now, among the reporter and the peers named.
    const present = await this.#db
      .select({ userId: presenceIntervals.userId })
      .from(presenceIntervals)
      .innerJoin(rooms, eq(rooms.id, presenceIntervals.roomId))
      .where(
        and(
          eq(presenceIntervals.roomId, roomId),
          isNull(presenceIntervals.endedAt),
          isNull(rooms.endedAt),
          inArray(presenceIntervals.userId, [reporter, ...peers]),
        ),
      );
    const inRoom = new Set(present.map((p) => p.userId));
    const inside = inRoom.has(reporter);
    // The pre-join is the one place a device can fail before the caller is in the room.
    const mayEnter =
      !inside && events.some((e) => e.kind === "device_error")
        ? await this.#mayEnter(caller, roomId)
        : inside;
    const allowed = events.filter((e) =>
      "peerId" in e ? inside && e.peerId !== reporter && inRoom.has(e.peerId) : mayEnter,
    );
    if (allowed.length < events.length) {
      // Not theirs to report: they aren't in the room (or may not enter it), or the event names
      // a peer who left since, or themselves.
      const peerGone = events.filter(
        (e) => "peerId" in e && inside && (e.peerId === reporter || !inRoom.has(e.peerId)),
      ).length;
      const refused = events.length - allowed.length;
      if (refused > peerGone) {
        logReportDropped("connection_event", "not_in_room", {
          userId: reporter,
          roomId,
          events: refused - peerGone,
        });
      }
      if (peerGone > 0) {
        logReportDropped("connection_event", "peer_not_in_room", {
          userId: reporter,
          roomId,
          events: peerGone,
        });
      }
    }
    if (allowed.length === 0) return { stored: 0, dropped: 0 };

    // The cap: the first events that fit are kept, the rest dropped.
    const cap = CONNECTION_EVENT_CAP;
    forgetIdle(this.#stored, cap.windowMs, now);
    const recent = this.#stored.get(reporter) ?? [];
    this.#stored.set(reporter, recent);
    const since = now.getTime() - cap.windowMs;
    const live = recent.filter((t) => t > since);
    const room = Math.max(0, cap.events - live.length);
    const kept = allowed.slice(0, room);
    const dropped = allowed.length - kept.length;
    recent.length = 0;
    recent.push(...live, ...kept.map(() => now.getTime()));
    if (dropped > 0) {
      logReportDropped("connection_event", "over_cap", {
        userId: reporter,
        roomId,
        events: dropped,
      });
      this.#drop(reporter, roomId, dropped, now);
    }
    if (kept.length === 0) return { stored: 0, dropped };

    const rows = kept.map((e) => rowOf(roomId, reporter, e, now));
    try {
      await this.#db.insert(roomTimelineEvents).values(rows);
    } catch (error) {
      // The allowance is for events that were stored: give it back so a retry can have it.
      this.#refund(recent, now.getTime(), kept.length);
      throw error;
    }
    for (const row of rows) logStored(row);
    return { stored: kept.length, dropped };
  }

  /** Resolves once the marker writes in flight are done. For tests. */
  async settled(): Promise<void> {
    await Promise.all([...this.#writes]);
  }

  /** Count `count` more drops for `reporter`, and (re)arm the write of their marker. */
  #drop(reporter: string, roomId: string, count: number, now: Date): void {
    const pending = this.#markers.get(reporter);
    // A run of drops that has gone on a whole window is written and a new one begun.
    const stale =
      pending && now.getTime() - pending.from.getTime() >= CONNECTION_EVENT_CAP.windowMs;
    if (pending && !stale) {
      pending.timer.cancel();
      pending.count += count;
      pending.timer = this.#clock.setTimer(DROP_MARKER_DELAY_MS, () => this.#writeMarker(reporter));
      return;
    }
    if (pending) this.#writeMarker(reporter);
    this.#markers.set(reporter, {
      roomId,
      from: now,
      count,
      timer: this.#clock.setTimer(DROP_MARKER_DELAY_MS, () => this.#writeMarker(reporter)),
    });
  }

  #writeMarker(reporter: string): void {
    const marker = this.#markers.get(reporter);
    if (!marker) return;
    this.#markers.delete(reporter);
    marker.timer.cancel();
    const row: TimelineEventRow = {
      roomId: marker.roomId,
      at: marker.from,
      kind: "events_dropped",
      actorUserId: reporter,
      targetUserId: null,
      details: { count: marker.count },
    };
    const write = Promise.resolve()
      .then(() => this.#db.insert(roomTimelineEvents).values(row))
      .then(
        () => logStored(row),
        (error: unknown) =>
          logTimelineWriteFailed(
            error,
            { roomId: row.roomId, userId: reporter },
            "writing an events-dropped marker failed",
          ),
      )
      .finally(() => this.#writes.delete(write));
    this.#writes.add(write);
  }

  #refund(recent: number[], at: number, count: number): void {
    let left = count;
    for (let i = recent.length - 1; i >= 0 && left > 0; i--) {
      if (recent[i] === at) {
        recent.splice(i, 1);
        left--;
      }
    }
  }
}

/** A stored row also goes to the server log, as the recorder does for the hub's events. */
function logStored(row: TimelineEventRow): void {
  try {
    logTimelineEvent({
      kind: row.kind,
      roomId: row.roomId,
      userId: row.actorUserId ?? undefined,
      targetUserId: row.targetUserId ?? undefined,
      at: row.at.toISOString(),
      details: row.details,
    });
  } catch {
    // The log is down; the timeline row is not affected.
  }
}

/** The timeline row for `event`, which `reporter` reported in `roomId` at `now`. */
function rowOf(
  roomId: string,
  reporter: string,
  event: ConnectionEventInput,
  now: Date,
): TimelineEventRow {
  const { kind, ageMs, ...rest } = event;
  const peerId = "peerId" in rest ? rest.peerId : null;
  const { peerId: _, ...details } = rest as { peerId?: string } & Record<string, unknown>;
  return {
    roomId,
    at: new Date(now.getTime() - Math.min(Math.max(ageMs, 0), MAX_EVENT_AGE_MS)),
    kind,
    actorUserId: reporter,
    targetUserId: peerId,
    details: boundDetails(details as TimelineEventRow["details"]),
  };
}

/** `sendBeacon` takes at most 64 KiB in all, so a body past it isn't from one. */
export const BEACON_MAX_BYTES = 64 * 1024;

/** A beacon's report, or why it is refused. */
export type BeaconRead =
  | { ok: true; input: ReportConnectionEventsInput }
  | { ok: false; status: 400 | 413; error: string };

/** The report in `request`'s body (JSON, however `sendBeacon` labelled it), bounded in size. */
export async function readBeacon(request: Request): Promise<BeaconRead> {
  if (Number(request.headers.get("content-length")) > BEACON_MAX_BYTES) {
    return { ok: false, status: 413, error: "Report too large" };
  }
  const bytes = await readBodyCapped(request, BEACON_MAX_BYTES);
  if (!bytes) return { ok: false, status: 413, error: "Report too large" };
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, status: 400, error: "Not JSON" };
  }
  const parsed = reportConnectionEventsInput.safeParse(body);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, status: 400, error: "Not a report" };
}

let service: ConnectionEventService | undefined;

/** The server's `ConnectionEventService`. */
export function getConnectionEventService(): ConnectionEventService {
  service ??= new ConnectionEventService({ db: getDb() });
  return service;
}
