/**
 * Adaptive quality (ADR 2): what each video sender to one peer encodes, chosen by a controller
 * that reads that connection's stats every few seconds. There is no user-facing control.
 *
 * A screen share moves along `SCREEN_LADDER` (720p30 at the bottom, 1080p30 by default, 1080p60
 * at the top), a camera along `CAMERA_LADDER` (180p15, and 360p15 by default). `nextRung` is the
 * decision, a pure function of a window of samples and the current rung; `step` wraps it with
 * the bookkeeping of probes:
 *
 * - Pressure is loss, a long round trip, a CPU limit, or a bandwidth limit while the estimate is
 *   clearly below what the sender is actually sending. Sending little (a still screen) is never
 *   pressure, and neither is a bandwidth limit the rung's own `maxBitrate` puts on the encoder:
 *   the estimate only probes up to about what is configured, so it says nothing about headroom.
 * - It steps down once `DOWN_SAMPLES` samples in a row show pressure, as far as the estimate
 *   says it must.
 * - It steps up one rung, as a probe, after a full window of clean samples. If the probe shows
 *   pressure, the step down brings it back and the next probe waits twice as long (`backoff`,
 *   up to `MAX_BACKOFF` doublings); a probe that stays clean for a window resets the wait.
 * - It never leaves `[min, max]`; a rung outside them moves inside at once.
 *
 * The thresholds are provisional (ADR 2 addendum).
 */

export interface Rung {
  label: string;
  /** Encoded height in pixels (the width follows the capture's aspect ratio). */
  height: number;
  frameRate: number;
  /** Bits per second. */
  maxBitrate: number;
}

/** Low to max. The default is `SCREEN_DEFAULT_RUNG`. */
export const SCREEN_LADDER: readonly Rung[] = [
  { label: "720p30", height: 720, frameRate: 30, maxBitrate: 1_500_000 },
  { label: "900p30", height: 900, frameRate: 30, maxBitrate: 2_200_000 },
  { label: "1080p30", height: 1080, frameRate: 30, maxBitrate: 3_000_000 },
  { label: "1080p45", height: 1080, frameRate: 45, maxBitrate: 4_500_000 },
  { label: "1080p60", height: 1080, frameRate: 60, maxBitrate: 6_000_000 },
];
export const SCREEN_DEFAULT_RUNG = 2;

/** 180p is where a camera goes under pressure; 360p15 is its default. */
export const CAMERA_LADDER: readonly Rung[] = [
  { label: "180p15", height: 180, frameRate: 15, maxBitrate: 150_000 },
  { label: "360p15", height: 360, frameRate: 15, maxBitrate: 500_000 },
];
export const CAMERA_DEFAULT_RUNG = 1;

/** What the encoder says holds it back (`qualityLimitationReason`). */
export type Limit = "none" | "bandwidth" | "cpu" | "other";

/** One reading of a sender's stats. Unknown values (a browser that lacks them) are absent. */
export interface StatsSample {
  /** The bandwidth estimate for sending (`availableOutgoingBitrate`), bits per second. */
  availableBitrate?: number;
  /** What the sender actually sent since the previous reading, bits per second. */
  sendBitrate?: number;
  /** Fraction of this sender's packets lost, 0 to 1, as the receiver reports. */
  loss: number;
  rttMs?: number;
  limit: Limit;
  /** The codec in use, `video/VP9` for instance. */
  codec?: string;
  /** For the next reading's `sendBitrate`. */
  bytesSent?: number;
  timestamp?: number;
}

/** Samples in a row showing pressure before stepping down (a few seconds each). */
export const DOWN_SAMPLES = 2;
/** Clean samples in a row before a probe up. */
export const UP_SAMPLES = 5;
/** Each failed probe doubles the wait, this many times at most. */
export const MAX_BACKOFF = 3;
/** The most samples a window needs to hold. */
export const WINDOW_SAMPLES = UP_SAMPLES * 2 ** MAX_BACKOFF;
/** Loss from which a sample shows pressure, and up to which it is clean. */
export const LOSS_DOWN = 0.05;
export const LOSS_UP = 0.01;
/** Round trip from which a sample shows pressure, and up to which it is clean. */
export const RTT_DOWN_MS = 500;
export const RTT_UP_MS = 300;
/** A bandwidth limit is pressure when the estimate is below this share of what is sent. */
export const ESTIMATE_SHORT = 0.8;

export interface RungOptions {
  /** Lowest and highest rung allowed (indexes). Default: the whole ladder. */
  min?: number;
  max?: number;
  /** Bits per second other senders to the same peer use, which this one can't have. */
  reserved?: number;
  /** Failed probes in a row: each doubles the clean window a probe needs. */
  backoff?: number;
}

const pressured = (sample: StatsSample): boolean =>
  sample.loss >= LOSS_DOWN ||
  (sample.rttMs ?? 0) >= RTT_DOWN_MS ||
  sample.limit === "cpu" ||
  (sample.limit === "bandwidth" &&
    sample.availableBitrate !== undefined &&
    sample.sendBitrate !== undefined &&
    sample.availableBitrate < sample.sendBitrate * ESTIMATE_SHORT);

const clean = (sample: StatsSample): boolean =>
  !pressured(sample) && sample.loss < LOSS_UP && (sample.rttMs ?? 0) < RTT_UP_MS;

/** The rung to send at next, given the newest `window` samples (oldest first) at `current`. */
export function nextRung(
  ladder: readonly Rung[],
  window: readonly StatsSample[],
  current: number,
  { min = 0, max = ladder.length - 1, reserved = 0, backoff = 0 }: RungOptions = {},
): number {
  const top = Math.max(min, Math.min(max, ladder.length - 1));
  if (current > top) return top;
  if (current < min) return min;

  const recent = window.slice(-DOWN_SAMPLES);
  if (current > min && recent.length === DOWN_SAMPLES && recent.every(pressured)) {
    // As low as the estimate says it must, and at least one rung.
    const estimates = recent.flatMap((sample) => sample.availableBitrate ?? []);
    const available =
      estimates.length > 0 ? Math.min(...estimates) - reserved : Number.POSITIVE_INFINITY;
    let target = current - 1;
    while (target > min && (ladder[target] as Rung).maxBitrate > available) target--;
    return target;
  }

  const needed = UP_SAMPLES * 2 ** Math.min(backoff, MAX_BACKOFF);
  if (current < top && window.length >= needed && window.slice(-needed).every(clean)) {
    return current + 1;
  }
  return current;
}

/** One video sender's place on its ladder, and what the controller remembers of its probes. */
export interface LadderState {
  rung: number;
  /** Samples since the rung last changed (or the sender restarted), oldest first. */
  window: StatsSample[];
  /** Failed probes in a row. */
  backoff: number;
  /** It stepped up and hasn't yet shown the new rung holds. */
  probing: boolean;
}

export const freshLadderState = (rung: number): LadderState => ({
  rung,
  window: [],
  backoff: 0,
  probing: false,
});

/** `state` after `sample`: the window grows, and the rung moves if `nextRung` says so. */
export function step(
  ladder: readonly Rung[],
  state: LadderState,
  sample: StatsSample,
  options: Omit<RungOptions, "backoff"> = {},
): LadderState {
  const window = [...state.window, sample].slice(-WINDOW_SAMPLES);
  const rung = nextRung(ladder, window, state.rung, { ...options, backoff: state.backoff });
  if (rung > state.rung) return { ...state, rung, window: [], probing: true };
  if (rung < state.rung) {
    const failedProbe = state.probing;
    return {
      rung,
      window: [],
      backoff: failedProbe ? Math.min(state.backoff + 1, MAX_BACKOFF) : state.backoff,
      probing: false,
    };
  }
  // A probe that has been clean for a window has held.
  if (state.probing && window.length >= UP_SAMPLES) {
    return { ...state, window, backoff: 0, probing: false };
  }
  return { ...state, window };
}

/**
 * The highest rung of `ladder` the capture can feed: not above its height, nor its frame rate
 * (a share of a 720p window gains nothing from a 1080p rung, nor a 30 fps capture from 60 fps).
 * Unknown settings cap nothing.
 */
export function captureCap(
  ladder: readonly Rung[],
  settings: { height?: number; frameRate?: number },
): number {
  let cap = 0;
  ladder.forEach((rung, i) => {
    const heightOk = settings.height === undefined || rung.height <= settings.height;
    // Captures report 29.97 for 30, and cameras dip in the dark: 30 fps is never a reason to cap.
    const rateOk =
      settings.frameRate === undefined || rung.frameRate <= Math.max(30, settings.frameRate + 1);
    if (heightOk && rateOk) cap = i;
  });
  return cap;
}

type StatsEntry = {
  id?: string;
  type: string;
  selectedCandidatePairId?: string;
  kind?: string;
  nominated?: boolean;
  state?: string;
  selected?: boolean;
  availableOutgoingBitrate?: number;
  currentRoundTripTime?: number;
  qualityLimitationReason?: string;
  fractionLost?: number;
  codecId?: string;
  mimeType?: string;
  bytesSent?: number;
  timestamp?: number;
};

/**
 * One sample from a video sender's `getStats()` (which also holds the connection's selected
 * candidate pair and the receiver's report on this sender). `previous`, the sample before it,
 * gives the bitrate actually sent in between.
 */
export function readSample(report: RTCStatsReport, previous?: StatsSample): StatsSample {
  const entries = [...(report as Map<string, StatsEntry>).values()];
  const pairId = entries.find((e) => e.type === "transport")?.selectedCandidatePairId;
  const pair =
    entries.find((e) => e.type === "candidate-pair" && pairId !== undefined && e.id === pairId) ??
    entries.find((e) => e.type === "candidate-pair" && e.selected) ??
    entries.find((e) => e.type === "candidate-pair" && e.nominated && e.state === "succeeded");
  const outbound = entries.find((e) => e.type === "outbound-rtp" && e.kind === "video");
  const loss = entries
    .filter((e) => e.type === "remote-inbound-rtp" && e.kind === "video")
    .reduce((worst, e) => Math.max(worst, e.fractionLost ?? 0), 0);
  const reason = outbound?.qualityLimitationReason;
  const codec = outbound?.codecId
    ? (report as unknown as Map<string, StatsEntry>).get(outbound.codecId)?.mimeType
    : undefined;
  const { bytesSent, timestamp } = outbound ?? {};
  const elapsed =
    timestamp !== undefined && previous?.timestamp !== undefined
      ? timestamp - previous.timestamp
      : 0;
  const sendBitrate =
    bytesSent !== undefined && previous?.bytesSent !== undefined && elapsed > 0
      ? ((bytesSent - previous.bytesSent) * 8_000) / elapsed
      : undefined;
  return {
    ...(pair?.availableOutgoingBitrate !== undefined && {
      availableBitrate: pair.availableOutgoingBitrate,
    }),
    ...(sendBitrate !== undefined && { sendBitrate }),
    loss,
    ...(pair?.currentRoundTripTime !== undefined && { rttMs: pair.currentRoundTripTime * 1000 }),
    limit: reason === "bandwidth" || reason === "cpu" || reason === "other" ? reason : "none",
    ...(codec && { codec }),
    ...(bytesSent !== undefined && { bytesSent }),
    ...(timestamp !== undefined && { timestamp }),
  };
}
