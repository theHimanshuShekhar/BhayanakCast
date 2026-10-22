/**
 * Collects a page's quality telemetry (./quality-telemetry.ts) from the readings the Mesh takes
 * of each video sender and receiver every quality pass. One `SampleWindow` per stream (a peer's
 * screen or camera, sent or received); once it has run `windowMs` its row goes out and the next
 * window starts from the reading that closed it. A sender's rung change closes its window too,
 * with the rung it was on and the one it moved to. A sender's codec switch (`codecSwitched`)
 * closes it too, and so does a change of the codec or the encoder its readings report. A
 * receiver is told when its peer stops sharing a slot (`setSharing`): the window so far goes out
 * as a last row and the readings of that slot are ignored until the peer shares it again.
 */
import {
  type CodecReason,
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

/** What ended a window early, apart from a reading that changed the codec or the encoder. */
type Ending =
  | { trigger: "rung"; to: string; reason: RungReason }
  | { trigger: "codec"; to: string; reason: CodecReason };

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
  /**
   * When the sender of stream `id` started (epoch milliseconds), if it is known: its rows say how
   * long after that they ended (`sinceStartMs`). A receiver's stream has none.
   */
  startedAt?: (id: StreamId) => number | undefined;
  /** Why the sender of stream `id` is on its codec, if it is known: its rows say so. */
  codecReason?: (id: StreamId) => CodecReason | undefined;
}

export class QualityCollector {
  readonly #emit: (sample: PendingSample) => void;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #startedAt: (id: StreamId) => number | undefined;
  readonly #codecReason: (id: StreamId) => CodecReason | undefined;
  readonly #streams = new Map<string, Stream>();
  /** Per peer and slot, whether they share it. Everything counts as shared until said. */
  readonly #shares = new Map<string, Map<QualitySlot, Share>>();

  constructor(options: QualityCollectorOptions) {
    this.#emit = options.emit;
    this.#windowMs = options.windowMs ?? SAMPLE_WINDOW_MS;
    this.#now = options.now ?? Date.now;
    this.#startedAt = options.startedAt ?? (() => undefined);
    this.#codecReason = options.codecReason ?? (() => undefined);
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
    if (changedCodec(stream.window, reading) || changedEncoder(stream.window, reading)) {
      // QP is only comparable within one codec, and encode time within one encoder: the window
      // ends where either changed (on the rung it had), and the next starts from this reading,
      // the first of the new codec or encoder.
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
    this.#close(stream, { trigger: "rung", to: to.label, reason });
    stream.rung = to;
  }

  /**
   * The sender `id` moved to the codec `to` (a MIME type) for `reason`: the window so far, which
   * ran on the codec it left, ends here as a row saying so. The rung is as it was. A stream not
   * read yet has no window to end.
   */
  codecSwitched(id: StreamId, to: string, reason: CodecReason): void {
    const stream = this.#streams.get(keyOf(id));
    if (stream) this.#close(stream, { trigger: "codec", to, reason });
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
  #close(stream: Stream, ending?: Ending, next?: StreamReading): void {
    const { id } = stream;
    const summary = stream.window.summarise();
    const startedAt = id.direction === "send" ? this.#startedAt(id) : undefined;
    const endedAt = this.#now();
    // A receiver that never got anything (a camera never shown, a share not begun: its
    // transceiver exists from the first negotiation) has no traffic to report. One that did and
    // now gets none has stalled, which is a row with a bitrate of 0. A window with no time in it
    // is a row only when a rung change or a codec switch ended it.
    if ((id.direction === "send" || stream.received) && (ending || summary.windowMs > 0)) {
      const rungChange = ending?.trigger === "rung" ? ending : undefined;
      const codecSwitch = ending?.trigger === "codec" ? ending : undefined;
      this.#emit({
        ...summary,
        // The stats are of the codec the window ran on, which a switch row's `codec` is not: its
        // QP would be taken for the new codec's, so it says none.
        ...(codecSwitch && { codec: codecSwitch.to, qp: null }),
        fromCodec: codecSwitch ? summary.codec : null,
        codecReason:
          id.direction === "send" ? (codecSwitch?.reason ?? this.#codecReason(id) ?? null) : null,
        peerId: id.peerId,
        slot: id.slot,
        direction: id.direction,
        trigger: ending?.trigger ?? "window",
        rung: stream.rung?.label ?? null,
        toRung: rungChange?.to ?? null,
        reason: rungChange?.reason ?? null,
        maxBitrate: stream.rung?.maxBitrate ?? null,
        sinceStartMs: startedAt === undefined ? null : Math.max(0, Math.round(endedAt - startedAt)),
        endedAt,
      });
    }
    stream.window = new SampleWindow(next ?? stream.window.latest);
  }
}

/** Whether `reading` is of another codec than `window` has been on. */
const changedCodec = (window: SampleWindow, reading: StreamReading) =>
  reading.codec !== undefined && window.codec !== undefined && reading.codec !== window.codec;

/**
 * Whether `reading` says another encoder than `window` has been on (a fall to software, say). A
 * browser that doesn't say, or stops saying, is not a change.
 */
const changedEncoder = (window: SampleWindow, reading: StreamReading) => {
  const { implementation, powerEfficient } = window.encoder;
  return (
    (reading.encoder?.implementation !== undefined &&
      implementation !== undefined &&
      reading.encoder.implementation !== implementation) ||
    (reading.encoder?.powerEfficient !== undefined &&
      powerEfficient !== undefined &&
      reading.encoder.powerEfficient !== powerEfficient)
  );
};
