/**
 * Recaps, client-safe half: the view the get-recap server function returns
 * (src/server/recaps.ts). A recap is an ended room's timeline, kept for 30 days
 * (ADR 11). Its minutes come from the same clamped, merged intervals as the
 * stats (src/server/intervals.ts), so the two always agree.
 */
import type { RoomPerson, RoomSummary } from "./rooms";

/** A continuous span, as ISO timestamps. */
export interface RecapSpan {
  start: string;
  end: string;
}

export interface RecapPerson extends RoomPerson {
  /** Held the host role when the room ended. */
  isHost: boolean;
  /** Time in the room: merged presence spans, earliest first. */
  presence: RecapSpan[];
  presenceMinutes: number;
  /** Time streaming: merged stream spans, earliest first. */
  streams: RecapSpan[];
  streamMinutes: number;
  /** Time in the room minus own streaming (ADR 11 "hours watched"). */
  watchMinutes: number;
  /** When their last thumbnail was captured (ISO; null if none). */
  thumbnailAt: string | null;
}

export interface Recap extends RoomSummary {
  /** ISO timestamp. */
  endedAt: string;
  /** From creation to end. */
  durationMinutes: number;
  /** Everyone who was present or streamed: the host first, then by first arrival. */
  people: RecapPerson[];
  /** Everyone's watch minutes added up. */
  totalWatchMinutes: number;
}
