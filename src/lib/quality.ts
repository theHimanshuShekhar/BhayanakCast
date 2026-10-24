/**
 * Adaptive quality (ADR 2): what each video sender to one peer encodes, chosen by a controller
 * that reads that connection's stats every few seconds. There is no user-facing control.
 *
 * A screen share moves along steps `screenSteps` builds from its own capture (a scale of the
 * capture times 30 or 60 fps, about 720p30 at the bottom), a camera along `CAMERA_LADDER` (180p15,
 * and 360p15 by default). `nextRung` is the decision, a pure function of a window of samples and
 * the current rung; `step` wraps it with the bookkeeping of probes:
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
 * Every pair adapts on its own connection's stats, but they share one uplink: `UplinkBudget` is
 * the streamer's budget for the sum of all the pairs' target bitrates. Each viewer is entitled to
 * an equal share of it (less what its link can't use, which the others may climb into), and a
 * pair's ceiling is the lower of that share and what its own link carries. A new pair starts at
 * the highest step that fits what the others leave, a probe up needs room in its share (or a
 * clean spell across the whole room, which grows the budget by that one probe), and pressure on
 * most pairs at once lowers it towards what was measured being sent. Cameras give way before
 * screens. `nextRung` and `step` stay pure: they propose a probe, and the Mesh asks the budget
 * before taking it.
 *
 * The thresholds are provisional (ADR 2 addendum).
 */

import { COSTLY_CODECS, canSwitchFrom } from "./codecs.ts";

export interface Rung {
  label: string;
  /** Encoded width in pixels, for a screen step (a camera's follows its capture). */
  width?: number;
  /** Encoded height in pixels (the width follows the capture's aspect ratio). */
  height: number;
  frameRate: number;
  /** Bits per second. */
  maxBitrate: number;
}

/** 180p is where a camera goes under pressure; 360p15 is its default. */
export const CAMERA_LADDER: readonly Rung[] = [
  { label: "180p15", height: 180, frameRate: 15, maxBitrate: 150_000 },
  { label: "360p15", height: 360, frameRate: 15, maxBitrate: 500_000 },
];
export const CAMERA_DEFAULT_RUNG = 1;

/** The most pixels a share's top step encodes: 2560x1440, the 3.7 MP class (ADR 2 addendum). */
export const MAX_CAPTURE_PIXELS = 2560 * 1440;
/** The pixel counts of 1080p, 900p and 720p: the steps below the top, at the capture's shape. */
const TIER_PIXELS = [1920 * 1080, 1600 * 900, 1280 * 720] as const;
/** A tier with more than this share of the top's pixels is too close to it to be a step. */
const NEAR_TOP = 0.8;
/** The anchor of the bitrate scale: 1080p30 costs this much. */
export const ANCHOR_BITRATE = 3_000_000;
/** Bits per pixel per frame, anchored so that 1080p30 is `ANCHOR_BITRATE`: about 0.0482. */
export const BITS_PER_PIXEL = ANCHOR_BITRATE / (1920 * 1080 * 30);
/** A capture reporting at least this many frames a second can feed 60 fps steps... */
const FEEDS_60_FROM = 59;
/** ...and keeps feeding them until it reports fewer than this (59.94 and 58 are both 60). */
const FEEDS_60_UNTIL = 50;

/** What a capture reports of itself (`MediaStreamTrack.getSettings()`); absent if unknown. */
export interface Capture {
  width?: number;
  height?: number;
  frameRate?: number;
}

/** What a step down gives up first: `framerate` (text-like rooms) or `size` (motion rooms). */
export type StepOrder = "framerate" | "size";

interface Size {
  width: number;
  height: number;
}
const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/**
 * `size` fitted to `MAX_CAPTURE_PIXELS` by pixel count, in its own shape, and never enlarged: a
 * 3440x1440 screen becomes 2968x1242, a 5120x1440 one 3620x1018, a 1440x2560 portrait one stays.
 */
export function fitCapture({ width, height }: Size): Size {
  const fit = Math.min(1, Math.sqrt(MAX_CAPTURE_PIXELS / (width * height)));
  return { width: even(width * fit), height: even(height * fit) };
}

/**
 * Whether a capture reporting `frameRate` can feed 60 fps steps. An unknown rate can, and a
 * capture that did before keeps doing so until it reports well below 60, so a rate that dithers
 * around the cutoff doesn't rebuild the steps (`was` is the answer last time).
 */
export function feeds60(frameRate: number | undefined, was?: boolean): boolean {
  if (frameRate === undefined) return true;
  return frameRate >= FEEDS_60_FROM || (was === true && frameRate >= FEEDS_60_UNTIL);
}

/**
 * The steps of a screen share, lowest first, built from its capture: each is a size times 30 or
 * 60 fps (60 only if the capture delivers it), and its `maxBitrate` is pixels x fps x
 * `BITS_PER_PIXEL`, so a step costs what it encodes whatever the shape of the screen.
 *
 * - **Sizes.** The top is the capture fitted to the pixel cap (`fitCapture`). Below it come the
 *   capture's shape at the pixel counts of 1080p, 900p and 720p, as far as they are well below
 *   the top. The lowest is about 720p's (today's floor); a capture smaller than that gets one
 *   size, never upscaled.
 * - **Order.** Text-like rooms (`giveUpFirst` `framerate`) lose 60 -> 30 fps at full size before
 *   any size; motion rooms (`size`) keep 60 fps while they shrink, and lose it only at the
 *   smallest size, which is the 30 fps floor.
 * - **Labels.** `1080p30` for a 16:9 size, else the encoded size, like `2968×1242@60`.
 *
 * A capture of unknown size is taken to be 1920x1080. A step's height is what the Mesh scales the
 * capture's to (`scaleResolutionDownBy`). `frameRate` is only compared with 60 via `feeds60`.
 */
export function screenSteps(capture: Capture, giveUpFirst: StepOrder): Rung[] {
  const known = (capture.width ?? 0) > 0 && (capture.height ?? 0) > 0;
  const top = fitCapture({
    width: known ? (capture.width as number) : 1920,
    height: known ? (capture.height as number) : 1080,
  });
  const topPixels = top.width * top.height;
  const below = TIER_PIXELS.filter((pixels) => pixels < topPixels * NEAR_TOP).map((pixels) => {
    const scale = Math.sqrt(pixels / topPixels);
    return { width: even(top.width * scale), height: even(top.height * scale) };
  });
  const sizes = [...below.reverse(), top];
  const sixty = feeds60(capture.frameRate);
  const sizedAt =
    (frameRate: number) =>
    (size: Size): [Size, number] => [size, frameRate];
  const steps =
    giveUpFirst === "framerate"
      ? [...sizes.map(sizedAt(30)), ...(sixty ? [sizedAt(60)(top)] : [])]
      : sixty
        ? [sizedAt(30)(sizes[0] as Size), ...sizes.map(sizedAt(60))]
        : sizes.map(sizedAt(30));
  return steps.map(([size, frameRate]) => ({
    label:
      size.width * 9 === size.height * 16
        ? `${size.height}p${frameRate}`
        : `${size.width}×${size.height}@${frameRate}`,
    ...size,
    frameRate,
    maxBitrate:
      Math.round((size.width * size.height * frameRate * BITS_PER_PIXEL) / 10_000) * 10_000,
  }));
}

/** What a step's `maxBitrate` is multiplied by for a pair sending H.264 or VP8 (ADR 2 addendum). */
export const CODEC_CAP_SCALE = 1.5;

/**
 * The cap of `step` for a sender actually sending `codec` (a MIME type, as stats report it): the
 * step's `maxBitrate`, times `CODEC_CAP_SCALE` for H.264 and VP8. AV1, VP9 and a codec not yet
 * known keep the step's own. This is the bitrate everything downstream works on (the encoding,
 * the budget, probes, the seed, the telemetry); a step's label does not change with it.
 */
export function codecCap(step: Rung, codec?: string): number {
  return codec && COSTLY_CODECS.includes(codec.toLowerCase())
    ? Math.round(step.maxBitrate * CODEC_CAP_SCALE)
    : step.maxBitrate;
}

/** `steps` with their caps for `codec` (`codecCap`), for the fits and decisions on a ladder. */
export const scaleSteps = (steps: readonly Rung[], codec?: string): readonly Rung[] =>
  codec ? steps.map((step) => ({ ...step, maxBitrate: codecCap(step, codec) })) : steps;

/**
 * Where a sender whose steps were rebuilt (the capture was resized, or its frame rate became or
 * stopped being 60) goes in the new `steps`: the step of the same size at the nearest frame rate,
 * or else, for a new size, the highest step that costs no more than `from` did. So a rebuild that
 * only adds or drops the 60 fps steps never moves a sender to another size.
 */
export function carryOver(from: Rung, steps: readonly Rung[]): number {
  let same: number | undefined;
  steps.forEach((step, i) => {
    if (step.width !== from.width || step.height !== from.height) return;
    const best = same === undefined ? undefined : (steps[same] as Rung);
    if (
      !best ||
      Math.abs(step.frameRate - from.frameRate) < Math.abs(best.frameRate - from.frameRate)
    ) {
      same = i;
    }
  });
  return same ?? fitRung(steps, from.maxBitrate);
}

/**
 * The highest rung of `ladder` that a capture of `height` lines can feed: a camera of 240 lines
 * gains nothing from the 360p rung. An unknown height caps nothing.
 */
export function heightCap(ladder: readonly Rung[], height?: number): number {
  let cap = 0;
  ladder.forEach((rung, i) => {
    if (height === undefined || rung.height <= height) cap = i;
  });
  return cap;
}

/** What the encoder says holds it back (`qualityLimitationReason`). */
export const LIMITS = ["none", "bandwidth", "cpu", "other"] as const;
export type Limit = (typeof LIMITS)[number];

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

/** Readings ignored after a sender starts: the bandwidth estimate is still ramping up. */
export const WARMUP_READINGS = 2;

/**
 * A share's first minute (ADR 2 addendum), counted from when its sender started: of a new share,
 * or of a new viewer on one (a screen that is hidden and shown again is neither). The picture is
 * soft until the controller has found where the pair settles, so it waits less: it ignores 1
 * reading instead of 2, and a probe up needs 2 clean samples instead of 5. Stepping down is not
 * sped up, and after the minute the normal windows apply.
 */
export const FIRST_MINUTE_MS = 60_000;
export const FIRST_MINUTE_WARMUP_READINGS = 1;
export const FIRST_MINUTE_UP_SAMPLES = 2;

/** How patient the controller is with one sender: readings ignored, and samples a probe needs. */
export interface Pace {
  warmup: number;
  upSamples: number;
}

/**
 * The pace of a sender that started `sinceStartMs` ago, with a first minute of `firstMinuteMs`
 * (a parameter so that tests of the Mesh can do without it). A clock that went back (a negative
 * time) is no first minute.
 */
export function paceOf(sinceStartMs: number, firstMinuteMs = FIRST_MINUTE_MS): Pace {
  return sinceStartMs >= 0 && sinceStartMs < firstMinuteMs
    ? { warmup: FIRST_MINUTE_WARMUP_READINGS, upSamples: FIRST_MINUTE_UP_SAMPLES }
    : { warmup: WARMUP_READINGS, upSamples: UP_SAMPLES };
}

/** Share of a step's `maxBitrate` that a pair's bandwidth estimate is seeded at. */
export const START_BITRATE_SHARE = 0.9;

/**
 * The bandwidth estimate to seed a screen pair at, in bits per second: `START_BITRATE_SHARE` of
 * the `maxBitrate` of the step it starts on, and never above the pair's `ceiling`. It goes into
 * the SDP as Chromium's `x-google-start-bitrate` (`withStartBitrate` in mesh.ts), instead of the
 * 300 kbps that every new connection starts its estimate at.
 */
export function seedBitrate(maxBitrate: number, ceiling = Number.POSITIVE_INFINITY): number {
  return Math.min(Math.round(maxBitrate * START_BITRATE_SHARE), ceiling);
}

export interface RungOptions {
  /** Lowest and highest rung allowed (indexes). Default: the whole ladder. */
  min?: number;
  max?: number;
  /** Bits per second other senders to the same peer use, which this one can't have. */
  reserved?: number;
  /** Failed probes in a row: each doubles the clean window a probe needs. */
  backoff?: number;
  /** Clean samples a probe needs before any backoff. Default `UP_SAMPLES` (see `paceOf`). */
  upSamples?: number;
  /**
   * A CPU limit is no pressure to step down for (the codec switch is still to answer it, see
   * `cpuHeld`). Strain still is, and a CPU-limited sample is still not clean enough to probe on.
   */
  ignoreCpu?: boolean;
}

/** The network shows strain: loss, a long round trip, or a bandwidth limit the estimate backs. */
export const strained = (sample: StatsSample): boolean =>
  sample.loss >= LOSS_DOWN ||
  (sample.rttMs ?? 0) >= RTT_DOWN_MS ||
  (sample.limit === "bandwidth" &&
    sample.availableBitrate !== undefined &&
    sample.sendBitrate !== undefined &&
    sample.availableBitrate < sample.sendBitrate * ESTIMATE_SHORT);

/** Strain, or a CPU limit (which no uplink budget can help: it shows on every pair at once). */
const pressured = (sample: StatsSample, ignoreCpu = false): boolean =>
  strained(sample) || (sample.limit === "cpu" && !ignoreCpu);

const clean = (sample: StatsSample): boolean =>
  !pressured(sample) && sample.loss < LOSS_UP && (sample.rttMs ?? 0) < RTT_UP_MS;

/** Whether `window` holds the clean spell a probe up needs after `backoff` failed ones. */
export function probeDue(
  window: readonly StatsSample[],
  backoff = 0,
  upSamples = UP_SAMPLES,
): boolean {
  const needed = upSamples * 2 ** Math.min(backoff, MAX_BACKOFF);
  return window.length >= needed && window.slice(-needed).every(clean);
}

/** The highest rung of `ladder` up to `top` whose bitrate fits in `room`, or else the lowest. */
export function fitRung(ladder: readonly Rung[], room: number, top = ladder.length - 1): number {
  let rung = Math.min(top, ladder.length - 1);
  while (rung > 0 && (ladder[rung] as Rung).maxBitrate > room) rung--;
  return rung;
}

/** The rung to send at next, given the newest `window` samples (oldest first) at `current`. */
export function nextRung(
  ladder: readonly Rung[],
  window: readonly StatsSample[],
  current: number,
  {
    min = 0,
    max = ladder.length - 1,
    reserved = 0,
    backoff = 0,
    upSamples,
    ignoreCpu,
  }: RungOptions = {},
): number {
  const top = Math.max(min, Math.min(max, ladder.length - 1));
  if (current > top) return top;
  if (current < min) return min;

  const recent = window.slice(-DOWN_SAMPLES);
  if (
    current > min &&
    recent.length === DOWN_SAMPLES &&
    recent.every((sample) => pressured(sample, ignoreCpu))
  ) {
    // As low as the estimate says it must, and at least one rung.
    const estimates = recent.flatMap((sample) => sample.availableBitrate ?? []);
    const available =
      estimates.length > 0 ? Math.min(...estimates) - reserved : Number.POSITIVE_INFINITY;
    let target = current - 1;
    while (target > min && (ladder[target] as Rung).maxBitrate > available) target--;
    return target;
  }

  return current < top && probeDue(window, backoff, upSamples) ? current + 1 : current;
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
  /**
   * Its own link holds it at this rung: it stepped down under pressure, and no higher rung has
   * held since. The share of the budget it can't use goes to the other pairs (`pairCeilings`).
   */
  limited: boolean;
}

export const freshLadderState = (rung: number): LadderState => ({
  rung,
  window: [],
  backoff: 0,
  probing: false,
  limited: false,
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
  const upSamples = options.upSamples ?? UP_SAMPLES;
  if (rung > state.rung) return { ...state, rung, window: [], probing: true };
  if (rung < state.rung) {
    const failedProbe = state.probing;
    return {
      rung,
      window: [],
      backoff: failedProbe ? Math.min(state.backoff + 1, MAX_BACKOFF) : state.backoff,
      probing: false,
      limited: true,
    };
  }
  // A probe that has been clean for a window has held.
  if (state.probing && window.length >= upSamples) {
    return { ...state, window, backoff: 0, probing: false, limited: false };
  }
  return { ...state, window };
}

/** Passes in a row with a CPU limit on at least half the pairs before the codec switch (about 8 s). */
export const SWITCH_PASSES = 2;

/**
 * One pair (the streamer's link to a viewer) as a pass saw it, past its warm-up: whether the
 * encoder of any of its video senders reports a CPU limit.
 */
export interface CodecPair {
  cpu: boolean;
  /** The codec it sends: AV1 or VP9 if any of its senders does. */
  codec?: string;
}

/** What the codec switch remembers of a streamer's share (ADR 2 addendum). */
export interface CodecWatch {
  /** Passes in a row that met the trigger. */
  passes: number;
  /** The switch has happened in this share: there is no second. */
  switched: boolean;
}

export const freshCodecWatch = (): CodecWatch => ({ passes: 0, switched: false });

/**
 * One pass over the streamer's video `pairs` (those past the warm-up, with a reading): `due` is
 * whether the codec switch fires now. It does when the encoder reports a CPU limit on at least
 * half the pairs (with one viewer, that pair is enough) in `SWITCH_PASSES` passes in a row, the
 * streamer is on AV1 or VP9 on some pair, and it hasn't switched in this share. A pass with no
 * pairs to judge, or short of the trigger, breaks the run.
 */
export function watchCodec(
  watch: CodecWatch,
  pairs: readonly CodecPair[],
): { watch: CodecWatch; due: boolean } {
  if (watch.switched) return { watch, due: false };
  const limited = pairs.filter((pair) => pair.cpu).length;
  const met =
    limited > 0 && limited * 2 >= pairs.length && pairs.some((p) => canSwitchFrom(p.codec));
  const passes = met ? watch.passes + 1 : 0;
  const due = passes >= SWITCH_PASSES;
  return { watch: { passes: due ? 0 : passes, switched: due }, due };
}

/**
 * Whether a CPU limit on a sender of `codec` is held back from stepping it down: while the codec
 * switch can still answer it (the sender is on AV1 or VP9 and the share hasn't switched). Once
 * switched, or on a codec the switch doesn't leave, it is pressure like any other.
 */
export const cpuHeld = (watch: CodecWatch, codec?: string): boolean =>
  !watch.switched && canSwitchFrom(codec);

/** ADR 2's floor for a streamer's uplink, bits per second. */
export const UPLINK_FLOOR = 25_000_000;
/** Kept back for audio: share audio and mics to nine viewers come to about 1.7 Mbps. */
export const AUDIO_ALLOWANCE = 2_000_000;
/** What the video budget starts from, until it measures better. */
export const INITIAL_UPLINK = UPLINK_FLOOR - AUDIO_ALLOWANCE;
/** Share of what was being sent under pressure that the budget keeps: some room is left. */
export const UPLINK_SHARE = 0.9;
/** One drop keeps at least this share of the budget: a quiet scene sends little at any rung. */
export const UPLINK_DROP_LIMIT = 0.7;

/** What one pass over every pair showed (the Mesh reads each pair every few seconds). */
export interface UplinkReading {
  /** Pairs with a reading to judge, and how many of them show strain on the network. */
  pairs: number;
  strainedPairs: number;
  /** Bits per second the streamer was sending in all, as measured. */
  sent: number;
}

/** What limits a viewer's pair besides its share of the budget. */
export interface PairLimits {
  /** What the pair's own link carries, bits per second, if it is known to hold the pair down. */
  link?: number;
}

/**
 * A pair's ceiling, in bits per second: the lowest of the limits on it. This is the one place it
 * is computed, so that a further term (the viewer's receive share) is one more argument here.
 */
export const ceilingOf = ({ fairShare, link }: { fairShare: number; link?: number }): number =>
  Math.min(fairShare, link ?? Number.POSITIVE_INFINITY);

/**
 * Each viewer's ceiling: the lower of its fair share of `budget` and what its own link carries
 * (`ceilingOf`). Every viewer is entitled to an equal share; one whose link carries less leaves
 * the rest of its share to the others, who divide it equally again (and a link that the larger
 * share then falls under binds in turn). Budget is left unused only when every viewer is
 * link-limited.
 */
export function pairCeilings(budget: number, pairs: readonly PairLimits[]): number[] {
  const ceilings = pairs.map(() => 0);
  let open = pairs.map((_, i) => i);
  let left = Math.max(0, budget);
  while (open.length > 0) {
    const fairShare = left / open.length;
    const ceilingFor = (i: number) => ceilingOf({ fairShare, link: (pairs[i] as PairLimits).link });
    const limited = open.filter((i) => ceilingFor(i) < fairShare);
    if (limited.length === 0) {
      for (const i of open) ceilings[i] = fairShare;
      break;
    }
    for (const i of limited) {
      ceilings[i] = ceilingFor(i);
      left -= ceilings[i] as number;
    }
    open = open.filter((i) => !limited.includes(i));
  }
  return ceilings;
}

/**
 * What the budget has been asked for by one claimant: a viewer of the screen (`target` is 0 until
 * its screen sender starts, but its share is kept for it) or a camera sender.
 */
export interface Claim {
  camera: boolean;
  /** Bits per second its sender targets now. */
  target: number;
  /** A screen's ceiling (`pairCeilings`). A camera has none. */
  ceiling?: number;
}

/**
 * How a claimant `self` asking to target `next` bits per second is judged. Within its own ceiling
 * it is entitled to it (`within`): its share is its own, and if other pairs sitting above theirs
 * have used it up, they are the ones to step down (`shedFirst`). Past its ceiling it would take
 * what other pairs are entitled to, so `committed` counts every other screen at no less than its
 * ceiling (a viewer that hasn't started included, a camera at its target) for the budget to
 * judge.
 */
export function probeClaim(
  claims: readonly Claim[],
  self: number,
  next: number,
): { within: boolean; committed: number } {
  const asking = claims[self];
  let committed = 0;
  claims.forEach((claim, i) => {
    const keep = i === self || claim.camera ? 0 : (claim.ceiling ?? 0);
    committed += Math.max(claim.target, keep);
  });
  return { within: asking?.ceiling !== undefined && next <= asking.ceiling, committed };
}

/** How far a screen sender's `target` is above its pair's `ceiling`: 0 within it, or if unknown. */
export const aboveCeiling = (target: number, ceiling?: number): number =>
  ceiling === undefined ? 0 : Math.max(0, target - ceiling);

/** A video sender that could step down to ease the budget. */
export interface Sheddable {
  camera: boolean;
  /** Its target bitrate now. */
  bitrate: number;
  /** How far above its ceiling it targets (0 if within it, and for a camera). */
  over?: number;
}

/**
 * Which of `senders` steps down first when the budget is short: a camera (the heaviest one)
 * before any screen; then the screen furthest above its ceiling (its pair took what others are
 * entitled to), then the heaviest. Undefined if there are none.
 */
export function shedFirst(senders: readonly Sheddable[]): number | undefined {
  const rank = (s: Sheddable) => [s.camera ? 1 : 0, s.over ?? 0, s.bitrate];
  let first: number | undefined;
  senders.forEach((sender, i) => {
    if (first === undefined) {
      first = i;
      return;
    }
    const [a, b] = [rank(sender), rank(senders[first] as Sheddable)];
    const differs = a.findIndex((v, k) => v !== b[k]);
    if (differs !== -1 && (a[differs] as number) > (b[differs] as number)) first = i;
  });
  return first;
}

/**
 * The streamer's uplink as one budget for the sum of all its video senders' target bitrates
 * (`maxBitrate` of each one's rung), owned by the Mesh and consulted by every pair's controller.
 * Starts at `INITIAL_UPLINK` and follows measurements:
 *
 * - One viewer's bad link is that pair's own business. The uplink is what is short when at least
 *   two pairs, and at least half of them, show strain (`strained`: not a CPU limit, which no
 *   uplink cures) in `DOWN_SAMPLES` passes in a row: the budget drops to `UPLINK_SHARE` of what
 *   was being sent then, but by no more than `UPLINK_DROP_LIMIT` at once (a still screen sends
 *   next to nothing, whatever the uplink), and the Mesh steps senders down until their targets
 *   fit.
 * - A probe up within the pair's own ceiling (`pairCeilings`) always goes ahead: pairs above
 *   theirs step down to make room. One past it has to fit the room left in the budget, counting
 *   every other pair at no less than its ceiling (`probeClaim`), or else is admitted only on its
 *   sender's turn (the Mesh says whose) after a clean spell (`UP_SAMPLES` passes without shared
 *   strain), and then the budget grows by just that probe, so beyond the budget one pair at a
 *   time tries. If the strain comes back the next spell is twice as long (`MAX_BACKOFF`
 *   doublings); a growth that has held for a window resets it.
 */
export class UplinkBudget {
  /** Bits per second the targets may add up to. */
  limit: number;
  /**
   * Whether `limit` is what was measured of the uplink under strain, and not still the start
   * (`INITIAL_UPLINK`, a floor ADR 2 assumes) or growth from it.
   */
  measured = false;
  #pressure = 0;
  #clean = 0;
  #backoff = 0;
  /** It grew, and hasn't yet shown the new size holds. */
  #growing = false;

  constructor(limit = INITIAL_UPLINK) {
    this.limit = limit;
  }

  /** What is left of the budget when `committed` bits per second are targeted already. */
  room(committed: number): number {
    return Math.max(0, this.limit - committed);
  }

  /** Take in one pass over the pairs. */
  observe({ pairs, strainedPairs, sent }: UplinkReading): void {
    if (strainedPairs < 2 || strainedPairs * 2 < pairs) {
      this.#pressure = 0;
      this.#clean++;
      if (this.#growing && this.#clean >= UP_SAMPLES) {
        this.#growing = false;
        this.#backoff = 0;
      }
      return;
    }
    this.#clean = 0;
    if (++this.#pressure < DOWN_SAMPLES) return;
    this.#pressure = 0;
    if (sent > 0) {
      this.limit = Math.min(
        this.limit,
        Math.max(sent * UPLINK_SHARE, this.limit * UPLINK_DROP_LIMIT),
      );
      this.measured = true;
    }
    if (this.#growing) {
      this.#growing = false;
      this.#backoff = Math.min(this.#backoff + 1, MAX_BACKOFF);
    }
  }

  /**
   * Whether a sender may take `extra` bits per second more, with `committed` targeted now (see
   * `probeClaim`). Past the budget that grows it, if it is the sender's `turn` and a clean spell
   * allows.
   */
  admit(committed: number, extra: number, turn = true): boolean {
    if (committed + extra <= this.limit) return true;
    if (!turn || this.#clean < UP_SAMPLES * 2 ** this.#backoff) return false;
    this.limit = committed + extra;
    this.#clean = 0;
    this.#growing = true;
    return true;
  }
}

export type StatsEntry = {
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
 * The candidate pair a connection uses, among a report's `entries`: the transport's selected
 * one, or (Firefox has no transport stats) the one flagged `selected`, or a nominated one that
 * succeeded.
 */
export function selectedPairOf(entries: readonly StatsEntry[]): StatsEntry | undefined {
  const pairId = entries.find((e) => e.type === "transport")?.selectedCandidatePairId;
  return (
    entries.find((e) => e.type === "candidate-pair" && pairId !== undefined && e.id === pairId) ??
    entries.find((e) => e.type === "candidate-pair" && e.selected) ??
    entries.find((e) => e.type === "candidate-pair" && e.nominated && e.state === "succeeded")
  );
}

/**
 * One sample from a video sender's `getStats()` (which also holds the connection's selected
 * candidate pair and the receiver's report on this sender). `previous`, the sample before it,
 * gives the bitrate actually sent in between.
 */
export function readSample(report: RTCStatsReport, previous?: StatsSample): StatsSample {
  const entries = [...(report as Map<string, StatsEntry>).values()];
  const pair = selectedPairOf(entries);
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
