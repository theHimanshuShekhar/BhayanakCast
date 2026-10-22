/**
 * Quality telemetry (ADR 2 addendum, ADR 11 addendum), shared by the client and the server: what a
 * browser measures of the video it sends and receives, summarised per window, and the schema the
 * server checks it against (`reportQualityFn`).
 *
 * Every browser in every room reports one row per video sender and per video receiver every
 * `SAMPLE_WINDOW_MS`, holding averages and deltas over that window, and one row at each rung
 * change (the window so far, which ends there, with the rung it was on and the one it moved to).
 * A reading is one stream's `getStats()` entry (`readStream`); a `SampleWindow` takes the
 * readings of a window and says what happened over it (`summarise`). A row says how old it is
 * (`ageMs`) rather than when it happened: the server dates it by its own clock (ADR 12), so a
 * page with a wrong clock can't put rows in the wrong place.
 *
 * A browser that lacks a stat (Firefox has no `qualityLimitationReason`, `targetBitrate` or
 * `availableOutgoingBitrate` on a sender) leaves it null, never 0: the row says "unknown", not
 * "nothing". A counter that went backwards (the stream restarted) is unknown too.
 */
import { z } from "zod";
import { CANDIDATE_TYPES, icePathOf, RELAY_PROTOCOLS, type RelayProtocol } from "./ice.ts";
import { LIMITS, type Limit, type StatsEntry, selectedPairOf } from "./quality.ts";

/**
 * How long a window runs before its row goes out, in milliseconds. Readings come with the
 * quality passes (every 4 s), so a row goes out at the pass nearest this.
 */
export const SAMPLE_WINDOW_MS = 30_000;
/** The shortest window a build may configure, so a typo can't turn the telemetry into a flood. */
export const SAMPLE_WINDOW_MIN_MS = 8_000;

/** The window for a configured value (e2e shortens it): the default unless a positive number. */
export function sampleWindowMs(configured: unknown): number {
  const ms = Number(configured);
  if (!Number.isFinite(ms) || ms <= 0) return SAMPLE_WINDOW_MS;
  return Math.max(SAMPLE_WINDOW_MIN_MS, ms);
}

/** The longest window a row may claim: a background tab's timers are throttled to a crawl. */
export const MAX_WINDOW_MS = 10 * 60_000;
/** The longest a share may have run when a row says so: a week, far past any session. */
export const MAX_SINCE_START_MS = 7 * 24 * 3_600_000;
/** Rows in one report: a full room's worth of senders and receivers, and some rung changes. */
export const QUALITY_BATCH_MAX = 64;
/** The oldest a row may be when it is reported. */
export const MAX_SAMPLE_AGE_MS = 5 * 60_000;
export const QUALITY_SLOTS = ["screen", "cam"] as const;
/** Whether a row is the sender's or the receiver's. */
export const QUALITY_DIRECTIONS = ["send", "recv"] as const;
export type QualityDirection = (typeof QUALITY_DIRECTIONS)[number];
/** A regular window, or the window a rung change or a codec switch ended. */
export const QUALITY_TRIGGERS = ["window", "rung", "codec"] as const;
export type QualityTrigger = (typeof QUALITY_TRIGGERS)[number];
export type QualitySlot = (typeof QUALITY_SLOTS)[number];

/** Why a sender moved to another rung (`toRung`): the controller's pressure or probe, and so on. */
export const RUNG_REASONS = ["pressure", "probe", "capture", "budget", "resume"] as const;
export type RungReason = (typeof RUNG_REASONS)[number];

/**
 * Why a video sender is on its codec (ADR 2, codecs addendum): the normal order, the up-front
 * pick of a hardware-encoded VP9, a Firefox streamer starting on H.264, or the codec switch
 * after the encoder reported a CPU limit.
 */
export const CODEC_REASONS = ["preferred", "hardware", "browser", "cpu"] as const;
export type CodecReason = (typeof CODEC_REASONS)[number];

export const BROWSERS = ["chrome", "edge", "firefox", "safari", "opera", "other"] as const;
export type BrowserName = (typeof BROWSERS)[number];

/** A ladder label like `1080p30`, or the encoded size of a share that isn't 16:9: `2968×1242@60`. */
const rungLabel = z.string().regex(/^[0-9a-z]{1,12}$|^[0-9]{1,5}×[0-9]{1,5}@[0-9]{2}$/);
const CODEC = /^video\/[\w.+-]{1,32}$/;
/** An encoder's name as the browser says it (`libvpx`, `SimulcastEncoderAdapter (libvpx, libvpx)`). */
const ENCODER = /^[\x20-\x7e]{1,128}$/;
const bitrate = z.number().int().min(0).max(1_000_000_000).nullable();
const count = z.number().int().min(0).max(1_000_000).nullable();
const candidateType = z.enum(CANDIDATE_TYPES).nullable();

/** One row. Every field but the identity ones is null when unknown. */
export const qualitySample = z
  .strictObject({
    /** The other end: who this browser sends to, or receives from. */
    peerId: z.string().min(1).max(64),
    /** How long ago the window ended, milliseconds. */
    ageMs: z.number().int().min(0).max(MAX_SAMPLE_AGE_MS),
    slot: z.enum(QUALITY_SLOTS),
    direction: z.enum(QUALITY_DIRECTIONS),
    trigger: z.enum(QUALITY_TRIGGERS),
    windowMs: z.number().int().min(0).max(MAX_WINDOW_MS),
    /**
     * A sender's rows: how long after its sender started (a new share, or a new viewer of one)
     * the window ended, which says how long the pair took to settle (ADR 2 addendum). Null when
     * unknown, and for receivers; absent from an older page's rows.
     */
    sinceStartMs: z.number().int().min(0).max(MAX_SINCE_START_MS).nullable().default(null),
    /** The sender's rung over the window (its rung before the change, for `rung` rows). */
    rung: rungLabel.nullable(),
    toRung: rungLabel.nullable(),
    reason: z.enum(RUNG_REASONS).nullable(),
    /** The rung's `maxBitrate`, bits per second. */
    maxBitrate: bitrate,
    /** The encoder's target, averaged over the window. */
    targetBitrate: bitrate,
    /** Sent or received over the window. */
    bitrate,
    /** The bandwidth estimate for sending, averaged. */
    availableBitrate: bitrate,
    /** Average QP over the window: Δ`qpSum` / Δframes. */
    qp: z.number().min(0).max(1_000).nullable(),
    /** For a `codec` row, the codec the sender moved to (its stats are of `fromCodec`). */
    codec: z.string().regex(CODEC).nullable(),
    /** A sender's rows: why it is on that codec. Null for receivers and older pages' rows. */
    codecReason: z.enum(CODEC_REASONS).nullable().default(null),
    /** A `codec` row: the codec the sender left. Null there too if the window never read one. */
    fromCodec: z.string().regex(CODEC).nullable().default(null),
    /**
     * A sender's encoder, as Chromium says it while capturing (`encoderImplementation`,
     * `powerEfficientEncoder`); null where the browser doesn't say, which is not "software".
     */
    encoderImplementation: z.string().regex(ENCODER).nullable().default(null),
    powerEfficientEncoder: z.boolean().nullable().default(null),
    /** Encode time per frame in ms: Δ`totalEncodeTime` / Δ`framesEncoded` (Chromium, Firefox). */
    encodeMs: z.number().min(0).max(100_000).nullable().default(null),
    frameWidth: z.number().int().min(0).max(16_384).nullable(),
    frameHeight: z.number().int().min(0).max(16_384).nullable(),
    fps: z.number().min(0).max(1_000).nullable(),
    limitation: z.enum(LIMITS).nullable(),
    /** Fraction of packets lost, 0 to 1. */
    loss: z.number().min(0).max(1).nullable(),
    rttMs: z.number().min(0).max(100_000).nullable(),
    /** Picture and full-frame requests, NACKs and keyframes over the window. */
    plis: count,
    firs: count,
    nacks: count,
    keyFrames: count,
    /** Freezes the receiver saw, and their total length. */
    freezes: count,
    freezeSeconds: z.number().min(0).max(1_000_000).nullable(),
    /** The selected candidate pair. */
    localCandidate: candidateType,
    remoteCandidate: candidateType,
    relayProtocol: z.enum(RELAY_PROTOCOLS).nullable(),
  })
  .refine((s) => {
    const changed = s.toRung !== null || s.reason !== null;
    // A sender is always on a rung, and a row ending in a change says where to and why; a
    // receiver can't tell what rung its sender is on. A codec switch leaves the rung as it was,
    // and says why the sender is on the codec it moved to.
    if (s.direction === "send") {
      return (
        s.rung !== null &&
        (s.trigger === "rung" ? s.toRung !== null && s.reason !== null : !changed) &&
        (s.trigger === "codec" ? s.codecReason !== null : s.fromCodec === null)
      );
    }
    return (
      s.trigger === "window" &&
      s.rung === null &&
      s.maxBitrate === null &&
      s.sinceStartMs === null &&
      s.codecReason === null &&
      s.fromCodec === null &&
      s.encoderImplementation === null &&
      s.powerEfficientEncoder === null &&
      s.encodeMs === null &&
      !changed
    );
  }, "a rung and its change, the codec reason and the encoder belong to sent rows only");
export type QualitySample = z.infer<typeof qualitySample>;

/**
 * A report's rows, each judged on its own: one that is malformed (a label this version doesn't
 * know, say) is dropped and the rest are kept, where checking the whole array would lose a
 * page's report for one row. A report with no valid row is refused.
 */
const sampleRows = z
  .array(z.unknown())
  .min(1)
  .max(QUALITY_BATCH_MAX)
  .transform((rows) =>
    rows.flatMap((row) => {
      const parsed = qualitySample.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .refine((rows) => rows.length > 0, "no valid row");

/** What a page reports (`reportQualityFn`): its rows, about peers in the room it is in. */
export const reportQualityInput = z.strictObject({
  roomId: z.string().min(1).max(64),
  samples: sampleRows,
});
export type ReportQualityInput = { roomId: string; samples: z.input<typeof qualitySample>[] };

/** The browser and its major version, from a user agent string (no version for one unknown). */
export function browserOf(userAgent: string): { name: BrowserName; major: number | null } {
  const major = (re: RegExp) => {
    const found = re.exec(userAgent)?.[1];
    return found === undefined ? undefined : Number(found);
  };
  // Order matters: Edge and Opera say Chrome too, and Chrome says Safari.
  const checks: [BrowserName, number | undefined][] = [
    ["edge", major(/\bEdg(?:e|A|iOS)?\/(\d+)/)],
    ["opera", major(/\bOPR\/(\d+)/)],
    ["firefox", major(/\b(?:Firefox|FxiOS)\/(\d+)/)],
    ["chrome", major(/(?:Chrome|CriOS)\/(\d+)/)],
    ["safari", major(/\bVersion\/(\d+)[\d.]* .*Safari\//)],
  ];
  for (const [name, found] of checks) if (found !== undefined) return { name, major: found };
  return { name: "other", major: null };
}

/** The `getStats()` entries these readings come from, with the fields beyond `StatsEntry`. */
type Entry = StatsEntry & {
  qpSum?: number;
  framesEncoded?: number;
  totalEncodeTime?: number;
  encoderImplementation?: string;
  powerEfficientEncoder?: boolean;
  framesDecoded?: number;
  keyFramesEncoded?: number;
  keyFramesDecoded?: number;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  targetBitrate?: number;
  roundTripTime?: number;
  bytesReceived?: number;
  packetsReceived?: number;
  packetsLost?: number;
  pliCount?: number;
  firCount?: number;
  nackCount?: number;
  freezeCount?: number;
  totalFreezesDuration?: number;
};

export type Direction = "send" | "recv";

/**
 * A sender's encoder, as far as the browser says: a row's `encoderImplementation` and
 * `powerEfficientEncoder`.
 */
export interface Encoder {
  implementation?: string;
  powerEfficient?: boolean;
}

/**
 * One video stream's stats at one instant. Counters (`bytes` and the rest down to `packetsLost`)
 * are cumulative since the stream began; the others are the value then. A field the browser
 * lacks is absent.
 */
export interface StreamReading {
  /** The stream's own timestamp, milliseconds. */
  at: number;
  bytes?: number;
  frames?: number;
  qpSum?: number;
  /** A sender's `totalEncodeTime`, seconds. */
  encodeSeconds?: number;
  keyFrames?: number;
  plis?: number;
  firs?: number;
  nacks?: number;
  freezes?: number;
  freezeSeconds?: number;
  packetsReceived?: number;
  packetsLost?: number;
  frameWidth?: number;
  frameHeight?: number;
  fps?: number;
  targetBitrate?: number;
  availableBitrate?: number;
  rttMs?: number;
  /** A sender's loss, as its receiver reports (a receiver's comes from its packet counters). */
  loss?: number;
  limit?: Limit;
  codec?: string;
  /** A sender's encoder, where the browser says (Chromium, while capturing). */
  encoder?: Encoder;
  localCandidate?: z.infer<typeof candidateType>;
  remoteCandidate?: z.infer<typeof candidateType>;
  relayProtocol?: RelayProtocol;
}

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** The encoder `stream` names. Empty or odd text, or a flag of another type, is the browser not saying. */
function encoderOf(stream: Entry): Encoder | undefined {
  const implementation =
    typeof stream.encoderImplementation === "string" && ENCODER.test(stream.encoderImplementation)
      ? stream.encoderImplementation
      : undefined;
  const powerEfficient =
    typeof stream.powerEfficientEncoder === "boolean" ? stream.powerEfficientEncoder : undefined;
  return implementation === undefined && powerEfficient === undefined
    ? undefined
    : { implementation, powerEfficient };
}

/**
 * The first video stream of `direction` in a sender's or receiver's `getStats()` report, with
 * the connection's selected candidate pair; undefined if the report has no such stream (yet).
 */
export function readStream(
  report: RTCStatsReport,
  direction: Direction,
): StreamReading | undefined {
  const entries = [...(report as Map<string, Entry>).values()];
  const stream = entries.find(
    (e) => e.type === (direction === "send" ? "outbound-rtp" : "inbound-rtp") && e.kind === "video",
  );
  if (!stream) return undefined;
  const pair = selectedPairOf(entries);
  const remote = entries.filter((e) => e.type === "remote-inbound-rtp" && e.kind === "video");
  const losses = remote.flatMap((e) => finite(e.fractionLost) ?? []);
  const rtt =
    finite(pair?.currentRoundTripTime) ??
    finite(remote.find((e) => finite(e.roundTripTime) !== undefined)?.roundTripTime);
  const reason = stream.qualityLimitationReason;
  const codec = stream.codecId
    ? (report as unknown as Map<string, Entry>).get(stream.codecId)?.mimeType
    : undefined;
  const selected = icePathOf(report).selected;
  const sent = direction === "send";
  const reading: Record<string, unknown> = {
    at: finite(stream.timestamp) ?? Date.now(),
    bytes: finite(sent ? stream.bytesSent : stream.bytesReceived),
    frames: finite(sent ? stream.framesEncoded : stream.framesDecoded),
    qpSum: finite(stream.qpSum),
    encodeSeconds: sent ? finite(stream.totalEncodeTime) : undefined,
    keyFrames: finite(sent ? stream.keyFramesEncoded : stream.keyFramesDecoded),
    plis: finite(stream.pliCount),
    firs: finite(stream.firCount),
    nacks: finite(stream.nackCount),
    freezes: finite(stream.freezeCount),
    freezeSeconds: finite(stream.totalFreezesDuration),
    packetsReceived: finite(stream.packetsReceived),
    packetsLost: finite(stream.packetsLost),
    frameWidth: finite(stream.frameWidth),
    frameHeight: finite(stream.frameHeight),
    fps: finite(stream.framesPerSecond),
    targetBitrate: finite(stream.targetBitrate),
    availableBitrate: finite(pair?.availableOutgoingBitrate),
    rttMs: rtt === undefined ? undefined : rtt * 1_000,
    loss: sent && losses.length > 0 ? Math.max(...losses) : undefined,
    limit:
      reason === "none" || reason === "bandwidth" || reason === "cpu" || reason === "other"
        ? reason
        : undefined,
    codec: codec && CODEC.test(codec) ? codec : undefined,
    encoder: sent ? encoderOf(stream) : undefined,
    localCandidate: selected?.local.type,
    remoteCandidate: selected?.remote.type,
    relayProtocol: selected?.local.relayProtocol,
  };
  // Absent, not undefined: a field a browser lacks is simply not there.
  for (const key of Object.keys(reading)) if (reading[key] === undefined) delete reading[key];
  return reading as unknown as StreamReading;
}

/** What a window says of its stream: the stats half of a row (see `qualitySample`). */
export type WindowSummary = Pick<
  QualitySample,
  | "windowMs"
  | "targetBitrate"
  | "bitrate"
  | "availableBitrate"
  | "qp"
  | "codec"
  | "encoderImplementation"
  | "powerEfficientEncoder"
  | "encodeMs"
  | "frameWidth"
  | "frameHeight"
  | "fps"
  | "limitation"
  | "loss"
  | "rttMs"
  | "plis"
  | "firs"
  | "nacks"
  | "keyFrames"
  | "freezes"
  | "freezeSeconds"
  | "localCandidate"
  | "remoteCandidate"
  | "relayProtocol"
>;

/** How much a cumulative counter grew; unknown if either end is missing or it went backwards. */
const grew = (from: number | undefined, to: number | undefined): number | undefined =>
  from !== undefined && to !== undefined && to >= from ? to - from : undefined;

const round = (value: number | undefined, places = 0): number | null =>
  value === undefined ? null : Math.round(value * 10 ** places) / 10 ** places;

/** Worst first: a window that was ever CPU-limited says so. */
const LIMIT_SEVERITY: readonly Limit[] = ["cpu", "bandwidth", "other", "none"];

/** Fields whose value over a window is the mean of its readings, not a change in a counter. */
type Meaned = "targetBitrate" | "availableBitrate" | "rttMs" | "loss";
const MEANED: readonly Meaned[] = ["targetBitrate", "availableBitrate", "rttMs", "loss"];

/**
 * The readings of one stream over a window. It starts from a reading (the last of the window
 * before, so counters are measured without a gap) and takes the ones after it; a window that
 * has taken none yet (a rung change right after another) falls back on its first.
 */
export class SampleWindow {
  readonly #first: StreamReading;
  #last: StreamReading;
  readonly #sums: Record<Meaned, { sum: number; n: number }> = {
    targetBitrate: { sum: 0, n: 0 },
    availableBitrate: { sum: 0, n: 0 },
    rttMs: { sum: 0, n: 0 },
    loss: { sum: 0, n: 0 },
  };
  #limit: Limit | undefined;
  #encoder: Encoder;

  constructor(first: StreamReading) {
    this.#first = first;
    this.#last = first;
    this.#encoder = { ...first.encoder };
  }

  /** The codec the stream last reported (the one the window ends on). */
  get codec(): string | undefined {
    return this.#last.codec ?? this.#first.codec;
  }

  /**
   * The encoder the stream last reported (the one the window ends on). Chromium says it only
   * while capturing, so a reading without it leaves what was known.
   */
  get encoder(): Encoder {
    return this.#encoder;
  }

  /** The newest reading, which the next window starts from. */
  get latest(): StreamReading {
    return this.#last;
  }

  add(reading: StreamReading): void {
    this.#last = reading;
    this.#encoder = {
      implementation: reading.encoder?.implementation ?? this.#encoder.implementation,
      powerEfficient: reading.encoder?.powerEfficient ?? this.#encoder.powerEfficient,
    };
    for (const key of MEANED) {
      const value = reading[key];
      if (value === undefined) continue;
      this.#sums[key].sum += value;
      this.#sums[key].n++;
    }
    if (
      reading.limit !== undefined &&
      (this.#limit === undefined ||
        LIMIT_SEVERITY.indexOf(reading.limit) < LIMIT_SEVERITY.indexOf(this.#limit))
    ) {
      this.#limit = reading.limit;
    }
  }

  /** Whether its readings reach `windowMs` (by the stream's own timestamps). */
  due(windowMs: number): boolean {
    return this.#last.at - this.#first.at >= windowMs;
  }

  #mean(key: Meaned): number | undefined {
    const { sum, n } = this.#sums[key];
    return n === 0 ? this.#first[key] : sum / n;
  }

  summarise(): WindowSummary {
    const first = this.#first;
    const last = this.#last;
    const elapsed = last.at - first.at;
    const bytes = grew(first.bytes, last.bytes);
    const frames = grew(first.frames, last.frames);
    const qp = grew(first.qpSum, last.qpSum);
    const encodeSeconds = grew(first.encodeSeconds, last.encodeSeconds);
    const lost = grew(first.packetsLost, last.packetsLost);
    const received = grew(first.packetsReceived, last.packetsReceived);
    // A receiver's loss is its own packets' (a sender's is what its receiver reports).
    const lossFraction =
      lost !== undefined && received !== undefined && lost + received > 0
        ? lost / (lost + received)
        : this.#mean("loss");
    // A window with no time in it (a rung change on the pass that closed one) has no counts or
    // rates: nothing happened in it, which is not the same as nothing having happened to count.
    const timed = elapsed > 0;
    const counted = (from: number | undefined, to: number | undefined) =>
      timed ? grew(from, to) : undefined;
    const rate = (amount: number | undefined) =>
      amount !== undefined && timed ? (amount * 1_000) / elapsed : undefined;
    const mean = (key: Meaned, places = 0) => round(this.#mean(key), places);
    return {
      windowMs: Math.max(0, Math.round(elapsed)),
      targetBitrate: mean("targetBitrate"),
      bitrate: round(rate(bytes === undefined ? undefined : bytes * 8)),
      availableBitrate: mean("availableBitrate"),
      qp: frames !== undefined && frames > 0 && qp !== undefined ? round(qp / frames, 2) : null,
      // The codec the collector compares readings against, so a row is always of one codec.
      codec: this.codec ?? null,
      encoderImplementation: this.encoder.implementation ?? null,
      powerEfficientEncoder: this.encoder.powerEfficient ?? null,
      encodeMs:
        frames !== undefined && frames > 0 && encodeSeconds !== undefined
          ? round((encodeSeconds * 1_000) / frames, 2)
          : null,
      frameWidth: round(last.frameWidth),
      frameHeight: round(last.frameHeight),
      fps: round(timed ? (rate(frames) ?? last.fps) : undefined, 1),
      limitation: this.#limit ?? last.limit ?? null,
      loss: round(lossFraction, 4),
      rttMs: mean("rttMs", 1),
      plis: round(counted(first.plis, last.plis)),
      firs: round(counted(first.firs, last.firs)),
      nacks: round(counted(first.nacks, last.nacks)),
      keyFrames: round(counted(first.keyFrames, last.keyFrames)),
      freezes: round(counted(first.freezes, last.freezes)),
      freezeSeconds: round(counted(first.freezeSeconds, last.freezeSeconds), 2),
      localCandidate: last.localCandidate ?? null,
      remoteCandidate: last.remoteCandidate ?? null,
      relayProtocol: last.relayProtocol ?? null,
    };
  }
}

/** A row waiting to go out, with when its window ended (epoch milliseconds). */
export type PendingSample = Omit<QualitySample, "ageMs"> & { endedAt: number };

/** Rows wait this long for company before they go out, so a pass's rows share one report. */
export const REPORT_DELAY_MS = 5_000;
/** Rows kept while reports fail; the oldest go first. */
const MAX_QUEUED = QUALITY_BATCH_MAX * 4;

export interface QualityReporterOptions {
  roomId: string;
  /** Sends one report (`reportQualityFn`); rejects if it fails. */
  send: (report: ReportQualityInput) => Promise<unknown>;
  /** Where a failed report is noted. Defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
  now?: () => number;
}

/**
 * Batches a page's rows for the server. They go over a server function, like the connection events (./connection-reporter.ts), and
 * not the room socket: the hub runs every socket's messages on one serial queue and this is
 * database work (ADR 4 addendum on flooding), samples don't depend on the socket being up, and
 * a report that fails costs a few rows, not a reconnect. Rows wait `REPORT_DELAY_MS` for company
 * (a rung change is stamped at once, but its report coalesces with its neighbours'), and a
 * report never holds more than `QUALITY_BATCH_MAX`. Telemetry is best-effort: a report that
 * fails is dropped, not retried.
 */
export class QualityReporter {
  readonly #options: QualityReporterOptions;
  #queue: PendingSample[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(options: QualityReporterOptions) {
    this.#options = options;
  }

  add(sample: PendingSample): void {
    if (this.#closed) return;
    this.#queue.push(sample);
    if (this.#queue.length > MAX_QUEUED) this.#queue.splice(0, this.#queue.length - MAX_QUEUED);
    this.#timer ??= setTimeout(() => void this.flush(), REPORT_DELAY_MS);
  }

  /** Send everything queued now, in reports of at most `QUALITY_BATCH_MAX` rows. */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const queued = this.#queue.splice(0);
    const { roomId, send, log = (m, e) => console.warn(`[quality] ${m}`, e) } = this.#options;
    const now = (this.#options.now ?? Date.now)();
    for (let i = 0; i < queued.length; i += QUALITY_BATCH_MAX) {
      const samples = queued.slice(i, i + QUALITY_BATCH_MAX).map(({ endedAt, ...sample }) => ({
        ...sample,
        ageMs: Math.min(MAX_SAMPLE_AGE_MS, Math.max(0, Math.round(now - endedAt))),
      }));
      try {
        await send({ roomId, samples });
      } catch (error) {
        log("reporting failed", error);
      }
    }
  }

  /** Stop: what is queued is dropped (the page has left the room, which the server would refuse). */
  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#queue = [];
  }
}
