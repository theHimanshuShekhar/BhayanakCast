/**
 * The room timeline (CONTEXT.md; ADR 4 and ADR 11 addendums), client-safe half: the kinds of
 * event the realtime hub records, the limits on what it stores, and the merged view an admin
 * reads (src/server/admin-timeline.ts). Chat is never recorded (ADR 4).
 */
import type { QualityDirection, QualitySlot, RungReason } from "./quality-telemetry.ts";
import type { RoomPerson } from "./rooms.ts";

/**
 * What the hub records, one row each. Text in the table (checked on the way in), so a new kind
 * needs no migration.
 */
export const TIMELINE_EVENT_KINDS = [
  "join",
  "leave",
  /** A socket closed while its user was in the room. */
  "disconnect",
  "grace_start",
  "grace_resume",
  "grace_expire",
  /** Another tab or device took the presence over, or a join elsewhere took them out of here. */
  "takeover",
  "host_change",
  "kick",
  "stop_share",
  "role_change",
  "knock_request",
  "knock_approve",
  "knock_deny",
  "knock_cancel",
  "rename",
  "room_end",
  /** An admin's site ban removed them from the room. */
  "ban",
  "share_start",
  "share_stop",
  "cam_on",
  "cam_off",
  "mic_on",
  "mic_off",
  /** One person's `rate_limited` and `bad_request` refusals in one minute, counted. */
  "refusals",
  /** The server dropped a socket that had stopped reading. */
  "slow_client",
  /** The server closed a socket for flooding it. */
  "flood_close",
  // Reported by browsers about their own connections (ADR 3 addendum), not by the hub; the actor
  // is the reporter and the target the peer of a pair, if the event is about one.
  /** A pair's connection state changed. */
  "pair_state",
  /** A pair began an ICE restart or started over. */
  "pair_restart",
  /** A restart ended: the pair connected again, or gave up. */
  "pair_recovery",
  /** The path a pair uses (direct or relay, and the transport), when it connects and when it changes. */
  "pair_path",
  /** A failed offer or answer, a refused description, or a negotiation that never finished. */
  "negotiation_error",
  /** The screen picker, the camera or the mic was refused or failed. */
  "device_error",
  /** The browser would not play a peer's audio before a click. */
  "audio_blocked",
  /** A person went over their cap of reported events; `details.count` were not recorded. */
  "events_dropped",
  // Problem reports (ADR 4 addendum): the actor is the reporter and the target the stream's owner.
  /** Someone reported a problem: `details` has `reportId`, `category`, `note` and `snapshot`. */
  "problem_report",
  /** A browser's snapshot for a report: `details.reportId` ties it to the report's `snapshot`. */
  "report_snapshot",
] as const;
export type TimelineEventKind = (typeof TIMELINE_EVENT_KINDS)[number];

/** What a row's `details` may hold: JSON, so it can be stored and sent to the admin page. */
export type TimelineJson =
  | string
  | number
  | boolean
  | null
  | TimelineJson[]
  | { [key: string]: TimelineJson };
export type TimelineDetails = { [key: string]: TimelineJson };

/** The refusals a summary counts (the others are not worth a row). */
export const SUMMARISED_REFUSALS = ["rate_limited", "bad_request"] as const;
export type SummarisedRefusal = (typeof SUMMARISED_REFUSALS)[number];

/** How long events are kept (ADR 11 addendum): longer than room data, like quality samples. */
export const TIMELINE_RETENTION_DAYS = 90;
/** How far back a room's presence, stream and host intervals reach: the room data's 30 days. */
export const TIMELINE_INTERVAL_DAYS = 30;

/** The most a row's `details` may take, as JSON. A bigger one is stored as `{ truncated: true }`. */
export const MAX_TIMELINE_DETAILS_BYTES = 1_024;
/** The most message-type and reason pairs one refusal summary counts; the rest go under `other`. */
export const MAX_REFUSAL_KEYS = 24;
/** The most entries a room's merged timeline returns; `truncated` says there were more. */
export const MAX_TIMELINE_ENTRIES = 5_000;

/** An event as stored. */
export interface TimelineEventRow {
  roomId: string;
  at: Date;
  kind: TimelineEventKind;
  actorUserId: string | null;
  targetUserId: string | null;
  details: TimelineDetails;
}

/** A refusal summary's `details`: `counts` by `"<message type>:<reason>"`. */
export interface RefusalDetails {
  counts: Record<string, number>;
}

/** One line of the merged timeline. Times are ISO strings, which sort as they read. */
export type RoomTimelineEntry =
  | {
      source: "event";
      at: string;
      kind: TimelineEventKind;
      actorUserId: string | null;
      targetUserId: string | null;
      details: TimelineDetails;
    }
  | {
      /** Someone's stretch in the room, a stream of theirs, or a stretch as host. */
      source: "presence" | "stream" | "host";
      at: string;
      userId: string;
      /** Null while the interval is still open. */
      endedAt: string | null;
    }
  | {
      /** A sender's quality step change (a `rung` row of the quality samples). */
      source: "quality";
      at: string;
      /** For `send` rows the streamer, for `recv` rows the viewer. */
      reporterUserId: string;
      peerUserId: string;
      direction: QualityDirection;
      slot: QualitySlot;
      rung: string | null;
      toRung: string | null;
      reason: RungReason | null;
    };

/** A room's timeline, oldest first, with the people it names. */
export interface RoomTimeline {
  entries: RoomTimelineEntry[];
  people: Record<string, RoomPerson>;
  /** There was more than `MAX_TIMELINE_ENTRIES`: this is the latest stretch, older entries are left out. */
  truncated: boolean;
}

/**
 * `details` as it will be stored: unchanged if within `max` bytes, else `{ truncated: true }`
 * with only the `keep` fields that were there, so a row can never grow without bound whatever a
 * call site passes.
 */
export function boundDetails(
  details: TimelineDetails,
  max = MAX_TIMELINE_DETAILS_BYTES,
  keep: readonly string[] = [],
): TimelineDetails {
  const bytes = new TextEncoder().encode(JSON.stringify(details)).length;
  if (bytes <= max) return details;
  // The fields that tie a row to what it belongs to (a report's ids) survive the cut: without
  // them the row is lost to whoever reads it by those.
  const kept = Object.fromEntries(
    keep.flatMap((key) => (key in details ? [[key, details[key]]] : [])),
  );
  return { truncated: true, ...kept };
}
