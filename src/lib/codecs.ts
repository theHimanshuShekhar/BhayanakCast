/**
 * Per-pair video codec choice (ADR 2): each side sends the best codec both support, in the order
 * AV1, VP9, H.264, VP8 (audio is always Opus). Each side tells the other which video codecs it
 * can decode (`decodableVideoCodecs`), and orders its senders' codecs by `orderCodecs` for
 * `setCodecPreferences`. What is left out here (a codec the peer can't decode) is also left out
 * of the offer, which keeps signalling small. Firefox has no AV1 or VP9 encode in some setups:
 * its capabilities simply lack them, and the pair falls back to the next codec both have.
 *
 * The streamer's own order can differ from that normal one (ADR 2, codecs addendum): a Firefox
 * streamer sends only H.264 or VP8, and a Chromium streamer whose AV1 would be software sends
 * a hardware VP9 first, or else a hardware H.264. `chooseStartOrder` picks it before a share or
 * camera starts, and `orderCodecs` takes it as input, so it stays pure.
 */
import type { BrowserName, CodecReason } from "./quality-telemetry.ts";

/** Best first. Codecs not listed (H.265, say) follow VP8. */
export const VIDEO_CODEC_PREFERENCE = ["video/av1", "video/vp9", "video/h264", "video/vp8"];

/**
 * The codecs a pair needs more bitrate on (ADR 2 addendum: caps by codec): H.264 needs several
 * times AV1's for the same sharpness, and VP8 is the other that falls behind. MIME types, lower case.
 */
export const COSTLY_CODECS = ["video/h264", "video/vp8"];

/**
 * The codecs a CPU-limited streamer leaves with the codec switch (ADR 2 addendum): software AV1
 * and VP9 are what a CPU limit shows on. MIME types, lower case.
 */
export const SWITCH_FROM = ["video/av1", "video/vp9"];

/** Whether the codec switch leaves `codec` (a MIME type, in any case; none known: no). */
export const canSwitchFrom = (codec?: string): boolean =>
  codec !== undefined && SWITCH_FROM.includes(codec.toLowerCase());

/** Retransmission and redundancy formats: kept, last, whichever codec is chosen. */
const AUXILIARY = /^video\/(rtx|red|ulpfec|flexfec-03)$/i;

const mime = (codec: { mimeType: string }) => codec.mimeType.toLowerCase();

/**
 * The order a streamer sends one kind of video (screen or camera) in, and why. Codecs not in
 * `order` follow it, unless `excludeOthers`: then they are left out of what the streamer sends.
 */
export interface StartOrder {
  /** MIME types, lower case, best first. */
  order: readonly string[];
  excludeOthers?: boolean;
  reason: CodecReason;
}

/**
 * The reason a sender's rows give for its codec: the `reason` its order had, but only while the
 * codec it sends (`codec`, once known) is the one that reason is about. `hardware` is about VP9
 * or H.264 and `browser` about H.264 and VP8; a viewer that can't decode those leaves the sender
 * on another codec, and the reason is then `preferred`. `cpu` (the codec switch) is about the codec
 * the switch moves to: a reading still on AV1 or VP9 (the stats lag the change by a pass, or the
 * pick was reverted) is `preferred`.
 */
export function codecReasonOf(reason: CodecReason, codec?: string): CodecReason {
  const type = codec?.toLowerCase();
  if (reason === "cpu") return canSwitchFrom(type) ? "preferred" : reason;
  if (reason === "hardware")
    return type === "video/vp9" || type === "video/h264" ? reason : "preferred";
  if (reason === "browser")
    return type === "video/h264" || type === "video/vp8" ? reason : "preferred";
  return reason;
}

/**
 * The order after the codec switch (ADR 2 addendum), on every video transceiver of the streamer:
 * H.264, then VP8, and AV1 and VP9 after them (ranked last, not left out, so that a later
 * re-offer can't revert the pick, and a viewer that has neither still gets a codec).
 */
export const SWITCHED_START: StartOrder = { order: ["video/h264", "video/vp8"], reason: "cpu" };
/** AV1, VP9, H.264, VP8. */
export const NORMAL_START: StartOrder = { order: VIDEO_CODEC_PREFERENCE, reason: "preferred" };
/** VP9 first, for a Chromium streamer whose VP9 is hardware-encoded and AV1 is not. */
export const HARDWARE_VP9_START: StartOrder = {
  order: ["video/vp9", ...VIDEO_CODEC_PREFERENCE.filter((type) => type !== "video/vp9")],
  reason: "hardware",
};
/** H.264 first, for a Chromium streamer whose H.264 is hardware-encoded and AV1 and VP9 are not. */
export const HARDWARE_H264_START: StartOrder = {
  order: ["video/h264", ...VIDEO_CODEC_PREFERENCE.filter((type) => type !== "video/h264")],
  reason: "hardware",
};
/** A Firefox streamer's: it encodes AV1 and VP9 in software only, and can't see a CPU limit. */
export const FIREFOX_START: StartOrder = {
  order: ["video/h264", "video/vp8"],
  excludeOthers: true,
  reason: "browser",
};

/**
 * `local` (what this side can send) in the order to offer them, `start` first (the streamer's
 * own order, the normal one by default), only those `remote` (the MIME types the peer can
 * decode) also has. With no `remote` yet, or none in common, nothing is left out (the browser
 * negotiates what both really have). A `start` that would leave out everything `local` has
 * changes nothing.
 */
export function orderCodecs<C extends { mimeType: string }>(
  local: readonly C[],
  remote?: readonly string[],
  start: StartOrder = NORMAL_START,
): C[] {
  const rank = (codec: C) => {
    const i = start.order.indexOf(mime(codec));
    return i === -1 ? start.order.length : i;
  };
  const all = local.filter((codec) => !AUXILIARY.test(codec.mimeType));
  const sent = start.excludeOthers ? all.filter((codec) => start.order.includes(mime(codec))) : all;
  const media = sent.length > 0 ? sent : all;
  const theirs = new Set(remote?.map((type) => type.toLowerCase()));
  const shared = remote ? media.filter((codec) => theirs.has(mime(codec))) : media;
  // A stable sort: the browser's order among a codec's variants (H.264 profiles) stays.
  const ordered = [...(shared.length > 0 ? shared : media)].sort((a, b) => rank(a) - rank(b));
  return [...ordered, ...local.filter((codec) => AUXILIARY.test(codec.mimeType))];
}

/**
 * The codec the switch moves a pair to, among the codecs it negotiated (`getParameters().codecs`,
 * so both sides have it): the first H.264, or else the first VP8. Never VP9: software VP9 isn't
 * reliably cheaper than AV1 on screen text. Undefined where the pair has neither.
 */
export function switchTarget<C extends { mimeType: string }>(
  negotiated: readonly C[],
): C | undefined {
  for (const type of ["video/h264", "video/vp8"]) {
    const found = negotiated.find((codec) => mime(codec) === type);
    if (found) return found;
  }
  return undefined;
}

/** The MIME types among `codecs` that carry video themselves, each once. */
export function videoMimeTypes(codecs: readonly { mimeType: string }[]): string[] {
  return [...new Set(codecs.filter((c) => !AUXILIARY.test(c.mimeType)).map((c) => c.mimeType))];
}

/** What this browser can send, and decode (as MIME types), for video. */
export interface VideoCodecs {
  send: RTCRtpCodec[];
  receive: string[];
}

/** This browser's video codecs, or undefined where it doesn't say (nothing is trimmed then). */
export function localVideoCodecs(): VideoCodecs | undefined {
  if (typeof RTCRtpSender === "undefined" || !RTCRtpSender.getCapabilities) return undefined;
  const send = RTCRtpSender.getCapabilities("video")?.codecs;
  const receive = RTCRtpReceiver.getCapabilities("video")?.codecs;
  return send && receive ? { send, receive: videoMimeTypes(receive) } : undefined;
}

/** What a share or camera captures, and the most it will be sent at: what an encoder is asked about. */
export interface Capture {
  width?: number;
  height?: number;
  frameRate?: number;
  /** Bits per second. */
  bitrate: number;
}

/** How long `chooseStartOrder` waits for the browser before taking the normal order. */
export const START_ORDER_TIMEOUT_MS = 500;

const CHROMIUM: readonly BrowserName[] = ["chrome", "edge", "opera"];

/**
 * The order a streamer on `browser` starts a share or camera in (ADR 2, codecs addendum).
 * Firefox: H.264 or VP8 (by user agent: its `powerEfficient` is wrong). Chromium: it asks the
 * browser whether encoding `capture` in AV1, VP9 and H.264 is power efficient (hardware): AV1
 * does, the normal order; else VP9 does, VP9 first; else H.264 does, H.264 first; else the normal
 * order. Safari and other browsers, an error, and no answer within `timeoutMs`: the normal order.
 */
export async function chooseStartOrder(
  browser: BrowserName,
  capture: Capture,
  capabilities: MediaCapabilities | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.mediaCapabilities,
  timeoutMs = START_ORDER_TIMEOUT_MS,
): Promise<StartOrder> {
  if (browser === "firefox") return FIREFOX_START;
  const { width, height, frameRate: framerate, bitrate } = capture;
  if (
    !CHROMIUM.includes(browser) ||
    !capabilities?.encodingInfo ||
    !width ||
    !height ||
    !framerate
  ) {
    return NORMAL_START;
  }
  const efficient = async (contentType: string) => {
    const info = await capabilities.encodingInfo({
      type: "webrtc",
      video: { contentType, width, height, bitrate, framerate },
    });
    return info.supported && info.powerEfficient;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<StartOrder>((resolve) => {
    timer = setTimeout(() => resolve(NORMAL_START), timeoutMs);
  });
  const asked = Promise.all([
    efficient("video/AV1"),
    efficient("video/VP9"),
    efficient("video/H264"),
  ]).then(
    ([av1, vp9, h264]) =>
      av1 ? NORMAL_START : vp9 ? HARDWARE_VP9_START : h264 ? HARDWARE_H264_START : NORMAL_START,
    () => NORMAL_START,
  );
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}
