/**
 * Per-pair video codec choice (ADR 2): each side sends the best codec both support, in the order
 * AV1, VP9, H.264, VP8 (audio is always Opus). Each side tells the other which video codecs it
 * can decode (`decodableVideoCodecs`), and orders its senders' codecs by `orderCodecs` for
 * `setCodecPreferences`. What is left out here (a codec the peer can't decode) is also left out
 * of the offer, which keeps signalling small. Firefox has no AV1 or VP9 encode in some setups:
 * its capabilities simply lack them, and the pair falls back to the next codec both have.
 */

/** Best first. Codecs not listed (H.265, say) follow VP8. */
export const VIDEO_CODEC_PREFERENCE = ["video/av1", "video/vp9", "video/h264", "video/vp8"];

/** Retransmission and redundancy formats: kept, last, whichever codec is chosen. */
const AUXILIARY = /^video\/(rtx|red|ulpfec|flexfec-03)$/i;

const mime = (codec: { mimeType: string }) => codec.mimeType.toLowerCase();

/**
 * `local` (what this side can send) in the order to offer them, only those `remote` (the MIME
 * types the peer can decode) also has. With no `remote` yet, or none in common, nothing is left
 * out (the browser negotiates what both really have).
 */
export function orderCodecs<C extends { mimeType: string }>(
  local: readonly C[],
  remote?: readonly string[],
): C[] {
  const rank = (codec: C) => {
    const i = VIDEO_CODEC_PREFERENCE.indexOf(mime(codec));
    return i === -1 ? VIDEO_CODEC_PREFERENCE.length : i;
  };
  const media = local.filter((codec) => !AUXILIARY.test(codec.mimeType));
  const theirs = new Set(remote?.map((type) => type.toLowerCase()));
  const shared = remote ? media.filter((codec) => theirs.has(mime(codec))) : media;
  // A stable sort: the browser's order among a codec's variants (H.264 profiles) stays.
  const ordered = [...(shared.length > 0 ? shared : media)].sort((a, b) => rank(a) - rank(b));
  return [...ordered, ...local.filter((codec) => AUXILIARY.test(codec.mimeType))];
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
