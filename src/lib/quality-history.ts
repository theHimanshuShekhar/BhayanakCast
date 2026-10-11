/**
 * The last minute of each screen-share stream between this page and one peer, in memory, for the
 * quality modal (ADR 2 addendum). The Mesh feeds it the readings it takes anyway (the 4-second
 * quality pass, and one more `getStats` a second on the pair whose modal is open) so the graphs
 * aren't empty when the modal opens. Nothing here is stored or sent anywhere.
 *
 * A stream is a string key (the Mesh uses `streamKey`). Its readings are cumulative counters, so
 * a point is what changed since the reading before: bitrate from the bytes, loss from the
 * packets. The first reading, a reading after a long gap, and one whose counters went backwards
 * (a new track under the same key) only set a new baseline.
 */
import { MAX_READING_GAP_MS } from "./quality-collector";
import type { ChangeCause } from "./quality-reason";
import type { StreamReading } from "./quality-telemetry";

/** How much of each stream is kept. */
export const HISTORY_MS = 60_000;
/** Readings closer than this make no point: two passes landing together would measure noise. */
export const MIN_READING_GAP_MS = 500;
/** How many step changes are kept per stream, however old: a quiet minute still shows how it got here. */
export const MAX_CHANGES = 20;

/** One instant of a stream. A value the browser doesn't report is absent. */
export interface QualityPoint {
  /** When it was taken, epoch milliseconds (this page's clock). */
  at: number;
  /** Bits per second sent or received since the reading before. */
  bps?: number;
  /** The step's `maxBitrate` then: what the streamer's encoder was allowed (a dashed line). */
  capBps?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  /** Fraction of packets lost, 0 to 1. */
  loss?: number;
  rttMs?: number;
  /** Freezes since the share began (as far as this page has watched it). */
  freezes?: number;
}

/**
 * A sender's move to another step, and what made it. The first has no `from`; a change whose
 * cause isn't known (a sender that didn't say) has none.
 */
export interface StepChange {
  at: number;
  from?: string;
  to: string;
  cause?: ChangeCause;
}

/** A `StepChange` (before it is stamped) for a move from `from` (if known) to `to`. */
export const stepChange = (
  from: string | undefined,
  to: string,
  cause: ChangeCause | undefined,
): Omit<StepChange, "at"> => ({
  ...(from && { from }),
  to,
  ...(cause && { cause }),
});

interface Stream {
  prev?: StreamReading;
  freezesBase?: number;
  latest?: StreamReading;
  points: QualityPoint[];
  changes: StepChange[];
}

/** The key of the stream of `peerId`'s screen: received from them, or sent to them. */
export const streamKey = (direction: "send" | "recv", peerId: string) => `${direction}/${peerId}`;

/**
 * How the pair connects, from a reading's selected candidate pair: `direct`, or `relay · UDP`
 * (TCP, TLS) through TURN. The transport is the local allocation's, so a relay on the far end
 * alone is just `relay`. Undefined before a pair is selected.
 */
export function pathLabel(reading: StreamReading | undefined): string | undefined {
  const { localCandidate: local, remoteCandidate: remote, relayProtocol } = reading ?? {};
  if (!local || !remote) return undefined;
  if (local !== "relay" && remote !== "relay") return "direct";
  return local === "relay" && relayProtocol ? `relay · ${relayProtocol.toUpperCase()}` : "relay";
}

export class QualityHistory {
  readonly #now: () => number;
  readonly #streams = new Map<string, Stream>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * Take `reading` of stream `key`, with the `capBps` its step allows then (if known). Returns the
   * point it made, if it made one.
   */
  observe(key: string, reading: StreamReading, capBps?: number): QualityPoint | undefined {
    const stream = this.#stream(key);
    const prev = stream.prev;
    const gap = prev ? reading.at - prev.at : 0;
    // Older than the last: two reads of one stream (the pass, the modal's refresh) that came back
    // out of order. Its counters are smaller, which must not pass for a new track (below), so it
    // is dropped before anything else, and isn't the newest reading either.
    if (gap < 0) return undefined;
    stream.latest = reading;
    const wentBack =
      prev !== undefined &&
      ((reading.bytes ?? 0) < (prev.bytes ?? 0) ||
        (reading.packetsReceived ?? 0) < (prev.packetsReceived ?? 0));
    if (!prev || gap > MAX_READING_GAP_MS || wentBack) {
      stream.prev = reading;
      stream.freezesBase = reading.freezes;
      return undefined;
    }
    // Too close together: two readings landing at once would measure noise.
    if (gap < MIN_READING_GAP_MS) return undefined;
    stream.prev = reading;

    const point: QualityPoint = { at: this.#now() };
    const set = <K extends keyof QualityPoint>(k: K, v: QualityPoint[K] | undefined) => {
      if (v !== undefined) point[k] = v;
    };
    const grew = (a?: number, b?: number) =>
      a !== undefined && b !== undefined ? b - a : undefined;
    const bytes = grew(prev.bytes, reading.bytes);
    set("bps", bytes === undefined ? undefined : (bytes * 8_000) / gap);
    set("capBps", capBps);
    set("width", reading.frameWidth);
    set("height", reading.frameHeight);
    set("fps", reading.fps);
    set("codec", reading.codec);
    set("rttMs", reading.rttMs);
    // A sender's loss is what its receiver reports; a receiver counts the packets it missed.
    const lost = grew(prev.packetsLost, reading.packetsLost);
    const received = grew(prev.packetsReceived, reading.packetsReceived);
    set(
      "loss",
      reading.loss ??
        (lost !== undefined && received !== undefined && lost + received > 0
          ? Math.max(0, lost) / (Math.max(0, lost) + received)
          : undefined),
    );
    if (reading.freezes !== undefined && stream.freezesBase !== undefined) {
      point.freezes = Math.max(0, reading.freezes - stream.freezesBase);
    }
    stream.points.push(point);
    this.#trim(stream);
    return point;
  }

  /** Add a point worked out elsewhere (a total of several streams). */
  record(key: string, point: Omit<QualityPoint, "at">): void {
    const stream = this.#stream(key);
    stream.points.push({ at: this.#now(), ...point });
    this.#trim(stream);
  }

  /** The points of `key` from the last minute, oldest first. */
  points(key: string): QualityPoint[] {
    const stream = this.#streams.get(key);
    if (!stream) return [];
    this.#trim(stream);
    return [...stream.points];
  }

  /** `key`'s newest reading, for what isn't a series (the path, the codec). */
  latest(key: string): StreamReading | undefined {
    return this.#streams.get(key)?.latest;
  }

  /** `key`'s sender moved to a step: noted at the time of the call. */
  changed(key: string, change: Omit<StepChange, "at">): void {
    const stream = this.#stream(key);
    stream.changes.push({ at: this.#now(), ...change });
    if (stream.changes.length > MAX_CHANGES) {
      stream.changes.splice(0, stream.changes.length - MAX_CHANGES);
    }
  }

  changes(key: string): StepChange[] {
    return [...(this.#streams.get(key)?.changes ?? [])];
  }

  /** The stream is over (the peer left, or the share ended): its points, changes and baseline go. */
  forget(key: string): void {
    this.#streams.delete(key);
  }

  #stream(key: string): Stream {
    let stream = this.#streams.get(key);
    if (!stream) {
      stream = { points: [], changes: [] };
      this.#streams.set(key, stream);
    }
    return stream;
  }

  #trim(stream: Stream): void {
    const from = this.#now() - HISTORY_MS;
    const keep = stream.points.findIndex((point) => point.at >= from);
    stream.points.splice(0, keep === -1 ? stream.points.length : keep);
  }
}
