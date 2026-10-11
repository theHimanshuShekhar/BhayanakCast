/**
 * Collects a page's quality telemetry (./quality-telemetry.ts) from the readings the Mesh takes
 * of each video sender and receiver every quality pass. One `SampleWindow` per stream (a peer's
 * screen or camera, sent or received); once it has run `windowMs` its row goes out and the next
 * window starts from the reading that closed it. A sender's rung change closes its window too,
 * with the rung it was on and the one it moved to. A receiver is told when its peer stops
 * sharing a slot (`setSharing`): the window so far goes out as a last row and the readings of
 * that slot are ignored until the peer shares it again.
 */
import {
  type Direction,
  type PendingSample,
  type QualitySlot,
  type RungReason,
  SAMPLE_WINDOW_MS,
  SampleWindow,
  type StreamReading,
} from "./quality-telemetry";

/** One video stream between this page and a peer. */
export interface StreamId {
  peerId: string;
  slot: QualitySlot;
  direction: Direction;
}

/** A sender's rung. */
export interface RungInfo {
  label: string;
  /** Bits per second. */
  maxBitrate: number;
}

interface Stream {
  id: StreamId;
  window: SampleWindow;
  rung: RungInfo | undefined;
  /** Something has been received on it (a reading with bytes in it). */
  received: boolean;
}

/**
 * What the server says about a peer's screen or camera, which a receive stream follows. It
 * outlives the stream's windows (a reconnect drops those, not this).
 */
interface Share {
  sharing: boolean;
  /** The peer began sharing again and no reading has been taken since. */
  fresh: boolean;
  /**
   * The byte count the share began from: the receiver's counters carry on from an earlier
   * share's, so only bytes past this are of this one. Undefined: from nothing.
   */
  baseline: number | undefined;
}

/**
 * A window closes once its readings span the window less this: they come with the quality
 * passes (every 4 s), and a pass that falls just short would leave the row a whole pass late.
 */
export const WINDOW_TOLERANCE_MS = 2_000;
/** Readings further apart than this (three passes) don't belong to one window. */
export const MAX_READING_GAP_MS = 12_000;

const keyOf = ({ peerId, slot, direction }: StreamId) => `${peerId}/${slot}/${direction}`;

export interface QualityCollectorOptions {
  /** Where finished rows go. */
  emit: (sample: PendingSample) => void;
  /** How long a window runs. Defaults to `SAMPLE_WINDOW_MS`. */
  windowMs?: number;
  /** Epoch milliseconds, for when a row ended. */
  now?: () => number;
}

export class QualityCollector {
  readonly #emit: (sample: PendingSample) => void;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #streams = new Map<string, Stream>();
  /** Per peer and slot, whether they share it. Everything counts as shared until said. */
  readonly #shares = new Map<string, Map<QualitySlot, Share>>();

  constructor(options: QualityCollectorOptions) {
    this.#emit = options.emit;
    this.#windowMs = options.windowMs ?? SAMPLE_WINDOW_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Take `reading` of the stream `id` (a sender's, with the `rung` it is on). */
  observe(id: StreamId, reading: StreamReading, rung?: RungInfo): void {
    const key = keyOf(id);
    const share = id.direction === "recv" ? this.#shares.get(id.peerId)?.get(id.slot) : undefined;
    if (share?.sharing === false) return;
    if (share?.fresh) {
      share.fresh = false;
      share.baseline = reading.bytes;
    }
    const stream = this.#streams.get(key);
    const gap = stream ? reading.at - stream.window.latest.at : 0;
    // A pause (the sender had no track, a stalled read) or a clock that went back starts over:
    // the window would span something other than the stream sending.
    const received = stream?.received === true || (reading.bytes ?? 0) > (share?.baseline ?? 0);
    if (!stream || gap < 0 || gap > MAX_READING_GAP_MS) {
      this.#streams.set(key, {
        id,
        window: new SampleWindow(reading),
        rung: rung ?? stream?.rung,
        received,
      });
      return;
    }
    stream.received = received;
    if (reading.codec && stream.window.codec && reading.codec !== stream.window.codec) {
      // QP is only comparable within one codec: the window ends where the codec changed (on the
      // rung it had), and the next starts from this reading, the new codec's first.
      this.#close(stream, undefined, reading);
      stream.rung = rung ?? stream.rung;
      return;
    }
    stream.rung = rung ?? stream.rung;
    stream.window.add(reading);
    if (stream.window.due(this.#windowMs - WINDOW_TOLERANCE_MS)) this.#close(stream);
  }

  /**
   * The sender `id` moved to rung `to`: the window so far ends here, as a row saying from which
   * rung and why. A stream not read yet has no window to end.
   */
  rungChanged(id: StreamId, to: RungInfo, reason: RungReason): void {
    const stream = this.#streams.get(keyOf(id));
    if (!stream) return;
    this.#close(stream, { to: to.label, reason });
    stream.rung = to;
  }

  /**
   * Whether `peerId` shares their `slot` (screen or camera) now, per the server. When they stop,
   * the receive stream's window goes out once as a last row (if it received anything) and
   * nothing more is reported on it, so a share that ended isn't taken for a stalled one. When
   * they share again it is a new stream.
   */
  setSharing(peerId: string, slot: QualitySlot, sharing: boolean): void {
    const shares = this.#shares.get(peerId) ?? new Map<QualitySlot, Share>();
    this.#shares.set(peerId, shares);
    if (sharing === (shares.get(slot)?.sharing ?? true)) return;
    if (sharing) {
      shares.set(slot, { sharing, fresh: true, baseline: undefined });
      return;
    }
    shares.set(slot, { sharing, fresh: false, baseline: undefined });
    const key = keyOf({ peerId, slot, direction: "recv" });
    const stream = this.#streams.get(key);
    if (stream) this.#close(stream);
    this.#streams.delete(key);
  }

  /** The stream `id` starts over (its sender has a new track): what its window holds is of another. */
  reset(id: StreamId): void {
    this.#streams.delete(keyOf(id));
  }

  /** The link to the peer is down: drop their streams' windows (they would span the outage). */
  dropWindows(peerId: string): void {
    for (const [key, stream] of this.#streams) {
      if (stream.id.peerId === peerId) this.#streams.delete(key);
    }
  }

  /** The peer is gone: drop their streams' windows and what was known of their shares. */
  forget(peerId: string): void {
    this.dropWindows(peerId);
    this.#shares.delete(peerId);
  }

  /** Send the window's row and start the next, from `next` or the reading that ended this one. */
  #close(stream: Stream, change?: { to: string; reason: RungReason }, next?: StreamReading): void {
    const { id } = stream;
    const summary = stream.window.summarise();
    // A receiver that never got anything (a camera never shown, a share not begun: its
    // transceiver exists from the first negotiation) has no traffic to report. One that did and
    // now gets none has stalled, which is a row with a bitrate of 0. A window with no time in it
    // is a row only when a rung change ended it.
    if ((id.direction === "send" || stream.received) && (change || summary.windowMs > 0)) {
      this.#emit({
        ...summary,
        peerId: id.peerId,
        slot: id.slot,
        direction: id.direction,
        trigger: change ? "rung" : "window",
        rung: stream.rung?.label ?? null,
        toRung: change?.to ?? null,
        reason: change?.reason ?? null,
        maxBitrate: stream.rung?.maxBitrate ?? null,
        endedAt: this.#now(),
      });
    }
    stream.window = new SampleWindow(next ?? stream.window.latest);
  }
}
