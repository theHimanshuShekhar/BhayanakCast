/**
 * The admin's view of a room's video quality (ADR 2 and ADR 11 addendums), client-safe half:
 * the views the admin server functions return (src/server/admin-quality.ts) and the aggregation
 * behind them. A pair is one streamer's screen or camera to one viewer; each end reports its own
 * rows (the sender's `send`, the receiver's `recv`), and the pair joins them.
 */
import { z } from "zod";
import type { CandidateType, RelayProtocol } from "./ice.ts";
import {
  QUALITY_SLOTS,
  type QualityDirection,
  type QualitySlot,
  type QualityTrigger,
  type RungReason,
} from "./quality-telemetry.ts";
import { type RoomKind, type RoomPerson, roomIdInput } from "./rooms.ts";

/** One pair's timeline. */
export const pairTimelineInput = roomIdInput.extend({
  streamerId: z.string().min(1).max(64),
  viewerId: z.string().min(1).max(64),
  slot: z.enum(QUALITY_SLOTS),
});
export type PairTimelineInput = z.input<typeof pairTimelineInput>;

/** The most rows a room's pair table reads (a long session with a full room is a few thousand). */
export const MAX_ROOM_SAMPLES = 50_000;
/** The most rows one pair's timeline reads. */
export const MAX_PAIR_SAMPLES = 5_000;

/**
 * A pair is "starved" when its target bitrate stays well below the step's `maxBitrate` while the
 * sender stays on a high step: the controller reads no pressure there (the encoder reports no
 * limit under `maintain-resolution`) yet the picture is only as good as the target. "Well below"
 * is under `STARVED_RATIO` of the step's, a "high" step one that costs at least what the step the
 * share started on did (steps are built for each share, so no absolute bitrate says what is
 * high), and it takes `STARVED_SHARE` of the time on such steps, over at least
 * `STARVED_MIN_SECONDS` of it, to count. Provisional, like the controller's own thresholds.
 */
export const STARVED_RATIO = 0.5;
export const STARVED_SHARE = 0.5;
export const STARVED_MIN_SECONDS = 60;

/** The columns of a stored sample that the views read. */
export interface QualityRow {
  at: Date;
  reporterUserId: string;
  peerUserId: string;
  direction: QualityDirection;
  slot: QualitySlot;
  trigger: QualityTrigger;
  windowMs: number;
  /** How long after its sender started the row's window ended; null for a receiver's rows. */
  sinceStartMs: number | null;
  browser: string;
  browserMajor: number | null;
  rung: string | null;
  maxBitrate: number | null;
  toRung: string | null;
  rungReason: RungReason | null;
  targetBitrate: number | null;
  bitrate: number | null;
  qp: number | null;
  codec: string | null;
  loss: number | null;
  rttMs: number | null;
  freezes: number | null;
  freezeSeconds: number | null;
  localCandidate: CandidateType | null;
  remoteCandidate: CandidateType | null;
  relayProtocol: RelayProtocol | null;
}

/** How the pair's packets travel: straight, or through a TURN relay (and over what). */
export interface QualityPath {
  kind: "direct" | "relay";
  /** A relay's transport to the TURN server, when the browser said. */
  relayProtocol: RelayProtocol | null;
}

/** Seconds a pair's sender spent on one rung. */
export interface RungTime {
  rung: string;
  seconds: number;
}

/** One streamer to viewer pair of a room, for one slot. */
export interface QualityPair {
  streamerId: string;
  viewerId: string;
  slot: QualitySlot;
  /** The viewer's browser, like `firefox 142`, as of their latest report in the room. */
  viewerBrowser: string | null;
  /** The codec the pair last used (the one `qp` is of). */
  codec: string | null;
  path: QualityPath | null;
  /** Lowest rung first. Empty if the sender never reported. */
  rungTimes: RungTime[];
  /**
   * Averages over the windows, weighted by their length; null if no end reported one. QP is only
   * comparable within one codec, so it averages the windows on the pair's latest `codec`, never
   * across a switch from one codec to another.
   */
  qp: number | null;
  loss: number | null;
  rttMs: number | null;
  /** The viewer's freezes and their total length; null if they never reported. */
  freezes: number | null;
  freezeSeconds: number | null;
  /** Set when the pair was starved (see `STARVED_RATIO`): on which rung, for what share of the time. */
  starved: { rung: string; share: number } | null;
  /**
   * Seconds from the sender's start to its first stable step: when its last step change before the
   * first window without one happened (0 if it never changed before one). Null until such a
   * window has closed, and for a sender that does not say when it started (see `settledOf`).
   */
  settledSeconds: number | null;
  /** Rung changes the sender reported. */
  rungChanges: number;
  /** First and last report, ISO timestamps. */
  firstAt: string;
  lastAt: string;
}

/** A pair, with the people named. */
export interface QualityPairRow extends QualityPair {
  streamer: RoomPerson;
  viewer: RoomPerson;
}

export interface RoomQuality {
  /** The room's kind as the samples recorded it; null if there are none. */
  roomKind: RoomKind | null;
  pairs: QualityPairRow[];
  samples: number;
  /** More samples than `MAX_ROOM_SAMPLES`: the pairs cover the first ones. */
  truncated: boolean;
}

/** A value at a time (epoch milliseconds, the end of the window it covers). */
export interface SeriesPoint {
  t: number;
  v: number;
}

/** A rung change of the sender's. */
export interface RungChange {
  t: number;
  from: string;
  to: string;
  reason: RungReason | "unknown";
}

/**
 * One pair's session as series, each with the points its reporting end had (the sender's and the
 * receiver's windows end at different times, so each series is its own). QP is the sender's, or
 * the receiver's if the sender reported none, and loss the receiver's, or else the sender's.
 */
export interface PairTimeline {
  /** Bits per second sent, the encoder's target, and the rung's `maxBitrate`. */
  sent: SeriesPoint[];
  target: SeriesPoint[];
  ceiling: SeriesPoint[];
  qp: SeriesPoint[];
  /** Fraction of packets lost, 0 to 1. */
  loss: SeriesPoint[];
  /** The sender's rung, as an index into `rungs` (lowest rung first). */
  rung: SeriesPoint[];
  rungs: string[];
  changes: RungChange[];
  /** More windows than `MAX_PAIR_SAMPLES`: the series cover the first ones. */
  truncated: boolean;
}

/** The mean of `pick` over `rows`, weighted by their window length; null if none has a value. */
function weighted(rows: readonly QualityRow[], pick: (row: QualityRow) => number | null) {
  let sum = 0;
  let weight = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null || row.windowMs <= 0) continue;
    sum += value * row.windowMs;
    weight += row.windowMs;
  }
  return weight === 0 ? null : sum / weight;
}

function total(rows: readonly QualityRow[], pick: (row: QualityRow) => number | null) {
  const values = rows.flatMap((row) => pick(row) ?? []);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

/** The streamer and viewer of a row: a sender's report names the viewer as its peer. */
const endsOf = (row: QualityRow) =>
  row.direction === "send"
    ? { streamerId: row.reporterUserId, viewerId: row.peerUserId }
    : { streamerId: row.peerUserId, viewerId: row.reporterUserId };

function pathOf(rows: readonly QualityRow[]): QualityPath | null {
  const seen = rows.filter((row) => row.localCandidate !== null || row.remoteCandidate !== null);
  if (seen.length === 0) return null;
  const relayed = seen.filter((r) => r.localCandidate === "relay" || r.remoteCandidate === "relay");
  if (relayed.length === 0) return { kind: "direct", relayProtocol: null };
  // Only the end whose own candidate is the relay knows how it reaches it.
  return {
    kind: "relay",
    relayProtocol: relayed.findLast((row) => row.relayProtocol !== null)?.relayProtocol ?? null,
  };
}

/**
 * When a pair settled (ADR 2 addendum): the first window of the sender's with no step change in it
 * is the first stable spell, and the pair settled where it began, at the time of the last step
 * change before it, or at its start if there was none. A row's `sinceStartMs` is when it ended,
 * and a step change ends the window it is in, so no window ever spans one. Null while no such
 * window has closed (not counting one a codec change cut short: `cutByCodec`), and for rows that
 * do not say when the sender started. `sent` is in time order. It is the pair's first settling in the room: a share that ended before it settled and
 * began again leaves its changes in the count, and a pair that reports several shares shows the
 * first.
 */
export function settledOf(sent: readonly QualityRow[]): number | null {
  let lastChange = 0;
  for (const [i, row] of sent.entries()) {
    if (row.sinceStartMs === null) return null;
    if (row.trigger === "rung") lastChange = row.sinceStartMs;
    else if (row.windowMs > 0 && !cutByCodec(row, sent[i + 1])) return lastChange / 1_000;
  }
  return null;
}

/**
 * Whether the window `row` was closed early by a codec change rather than run out: the sender's
 * next row names another codec. Such a window is no spell on one step (the collector ends a
 * window where the codec changes, so that its QP is of one codec).
 */
const cutByCodec = (row: QualityRow, next: QualityRow | undefined): boolean =>
  row.codec !== null && next?.codec != null && next.codec !== row.codec;

function starvedOf(sent: readonly QualityRow[]): QualityPair["starved"] {
  // The step it started on: the first one it reported (rows are in time order).
  const started = sent.find((row) => row.rung !== null && row.maxBitrate !== null)?.maxBitrate;
  const high = sent.filter(
    (row) =>
      row.windowMs > 0 &&
      row.rung !== null &&
      row.maxBitrate !== null &&
      started !== undefined &&
      started !== null &&
      row.maxBitrate >= started &&
      row.targetBitrate !== null,
  );
  const starved = high.filter(
    (row) => (row.targetBitrate as number) < STARVED_RATIO * (row.maxBitrate as number),
  );
  const seconds = (rows: readonly QualityRow[]) => rows.reduce((a, r) => a + r.windowMs, 0) / 1_000;
  const share = seconds(starved) / (seconds(high) || 1);
  if (seconds(starved) < STARVED_MIN_SECONDS || share < STARVED_SHARE) return null;
  const byRung = new Map<string, number>();
  for (const row of starved) {
    byRung.set(row.rung as string, (byRung.get(row.rung as string) ?? 0) + row.windowMs);
  }
  const [rung] = [...byRung].sort((a, b) => b[1] - a[1])[0] ?? [];
  return rung === undefined ? null : { rung, share };
}

/**
 * The pairs in `rows` (a room's samples, any order): one per streamer, viewer and slot, in the
 * order they were first reported. Averages weigh each window by its length, QP comes from the
 * sender (the receiver's if the sender didn't report one) and only from windows on the pair's
 * latest codec, and loss from the receiver (the sender's if there is none), as the better view
 * of each.
 */
export function aggregatePairs(rows: readonly QualityRow[]): QualityPair[] {
  const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  // Everyone's browser as of their latest report: a viewer who only receives reports it too.
  const browsers = new Map<string, string>();
  for (const row of sorted) {
    browsers.set(row.reporterUserId, `${row.browser} ${row.browserMajor ?? ""}`.trim());
  }
  const groups = new Map<string, QualityRow[]>();
  for (const row of sorted) {
    const { streamerId, viewerId } = endsOf(row);
    const key = JSON.stringify([streamerId, viewerId, row.slot]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as QualityRow;
    const last = group[group.length - 1] as QualityRow;
    const { streamerId, viewerId } = endsOf(first);
    const sent = group.filter((r) => r.direction === "send");
    const received = group.filter((r) => r.direction === "recv");
    const maxOf = new Map<string, number>();
    const times = new Map<string, number>();
    for (const row of sent) {
      if (row.rung === null) continue;
      times.set(row.rung, (times.get(row.rung) ?? 0) + row.windowMs / 1_000);
      if (row.maxBitrate !== null) maxOf.set(row.rung, row.maxBitrate);
    }
    const codec = group.findLast((r) => r.codec !== null)?.codec ?? null;
    const onCodec = (rows: readonly QualityRow[]) => rows.filter((r) => r.codec === codec);
    return {
      streamerId,
      viewerId,
      slot: first.slot,
      viewerBrowser: browsers.get(viewerId) ?? null,
      codec,
      path: pathOf(group),
      rungTimes: [...times]
        .sort((a, b) => (maxOf.get(a[0]) ?? 0) - (maxOf.get(b[0]) ?? 0))
        .map(([rung, seconds]) => ({ rung, seconds })),
      qp:
        codec === null
          ? null
          : (weighted(onCodec(sent), (r) => r.qp) ?? weighted(onCodec(received), (r) => r.qp)),
      loss: weighted(received, (r) => r.loss) ?? weighted(sent, (r) => r.loss),
      rttMs: weighted(group, (r) => r.rttMs),
      freezes: total(received, (r) => r.freezes),
      freezeSeconds: total(received, (r) => r.freezeSeconds),
      starved: starvedOf(sent),
      settledSeconds: settledOf(sent),
      rungChanges: sent.filter((r) => r.trigger === "rung").length,
      firstAt: first.at.toISOString(),
      lastAt: last.at.toISOString(),
    };
  });
}

/** One pair's rows (both ends, any order) as a timeline. */
export function timelineOf(rows: readonly QualityRow[]): PairTimeline {
  const sorted = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const sent = sorted.filter((r) => r.direction === "send");
  const received = sorted.filter((r) => r.direction === "recv");
  const series = (from: readonly QualityRow[], pick: (row: QualityRow) => number | null) =>
    from.flatMap((row): SeriesPoint[] => {
      const v = pick(row);
      return v === null || row.windowMs <= 0 ? [] : [{ t: row.at.getTime(), v }];
    });
  const maxOf = new Map<string, number>();
  for (const row of sent)
    if (row.rung && row.maxBitrate !== null) maxOf.set(row.rung, row.maxBitrate);
  const rungs = [...maxOf].sort((a, b) => a[1] - b[1]).map(([rung]) => rung);
  // QP of the latest codec only (see `QualityPair.qp`).
  const qpOf = (from: readonly QualityRow[]) => {
    const codec = from.findLast((r) => r.codec !== null)?.codec;
    return series(
      from.filter((r) => r.codec === codec),
      (r) => r.qp,
    );
  };
  const qpSent = qpOf(sent);
  const lossReceived = series(received, (r) => r.loss);
  return {
    sent: series(sent, (r) => r.bitrate),
    target: series(sent, (r) => r.targetBitrate),
    ceiling: series(sent, (r) => r.maxBitrate),
    qp: qpSent.length > 0 ? qpSent : qpOf(received),
    loss: lossReceived.length > 0 ? lossReceived : series(sent, (r) => r.loss),
    rung: sent.flatMap((row): SeriesPoint[] => {
      const v = row.rung === null ? -1 : rungs.indexOf(row.rung);
      return v < 0 ? [] : [{ t: row.at.getTime(), v }];
    }),
    rungs,
    truncated: false,
    changes: sent.flatMap((row): RungChange[] =>
      row.trigger === "rung" && row.rung !== null && row.toRung !== null
        ? [
            {
              t: row.at.getTime(),
              from: row.rung,
              to: row.toRung,
              reason: row.rungReason ?? "unknown",
            },
          ]
        : [],
    ),
  };
}
