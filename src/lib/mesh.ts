/**
 * The Mesh (ADR 1 and its connection model): one `RTCPeerConnection` to every other person in
 * the room, written against the native WebRTC API. It hides negotiation from the room UI:
 *
 *   const mesh = new Mesh({ selfId, send: (to, payload) => socket.send({ type: "signal", to, payload }) });
 *   mesh.join(participants);                  // the room's people (a snapshot); again on any change
 *   mesh.receive(from, payload);              // each relayed `signal`
 *   mesh.setLocalTracks({ mic: track });      // what this page sends everyone (null: stop)
 *   mesh.setVisible(peerId, "cam", false);    // this page isn't showing their camera now
 *   mesh.subscribe((event) => …);             // remote tracks and per-peer connection state
 *   mesh.close();                             // leave: every connection closed
 *
 * Negotiation is the perfect negotiation pattern: either side may offer whenever its tracks
 * change, and in a collision the polite side (the lower user id) rolls back and answers. Each
 * side sends over transceivers of its own, one per `MediaSlot`, created the first time the slot
 * has a track and reused (`replaceTrack`) after that, so muting and unmuting never renegotiate.
 * The mic's is created at once, so every pair connects as soon as both are in the room. Offers
 * carry which slot each of the sender's transceivers (by `mid`) carries.
 *
 * The first negotiation of a pair never collides: the impolite side offers, and the polite side
 * adds its own transceivers only once it has answered. (Chromium can stop gathering ICE
 * candidates for good when a connection's very first offer is rolled back.) Later collisions,
 * over an established transport, are left to perfect negotiation.
 *
 * Every connection has a `session` id sent with its signalling; a new one from a peer means they
 * started over (a reload, or a takeover by another tab) and this side starts over too, and a
 * step addressed to an older session of ours is dropped. A polite side says `hello` when it
 * opens a connection without an offer in hand, so an impolite peer still holding one to its old
 * page offers afresh, and one whose first offer was lost (the server drops signalling to someone
 * in their reconnect grace) sends it again.
 *
 * `send` says whether the step went out: while the page's own socket is reconnecting it doesn't.
 * A description lost that way (an offer, or an answer) is kept, and `resend` (the socket is back
 * in the room) sends it again, in order, unless negotiation has moved on: an offer only while it
 * is still the pending one. Each goes as it stands then, with the candidates gathered since.
 * Candidates and `visibility` steps are not kept (a description sent again carries the
 * candidates, and the pair's state is told again whenever it connects).
 *
 * A connection that fails, or doesn't connect within `CONNECT_TIMEOUT_MS`, gets one ICE restart
 * (with the latest ICE servers: STUN plus TURN, ADR 3), or one start-over if it never even
 * negotiated; if that fails too it is `failed` until `retry` starts it over (or until TURN
 * credentials arrive for a page that started on STUN alone: then one more ICE restart). Once
 * connected, its selected candidate pair says whether it is `relayed` through TURN. `relayed`,
 * and `failed` after ICE was tried, come with the connection's anonymised ICE path.
 *
 * A camera this page isn't showing (a hidden or scrolled-away tile) is paused towards it, to save
 * the sender's upload (ADR 2 addendum): `setVisible` tells that peer with a `visibility` step
 * (over signalling, which needs no ICE; the whole state again whenever the pair connects, in
 * case a step was lost), and the sender swaps in no track for this page alone until shown.
 *
 * A screen share is tuned as its track says (ADR 2 addendum): the sender's degradation
 * preference follows the screen track's `contentHint`, and share audio goes as stereo Opus at
 * `SHARE_AUDIO_BITRATE` (asked for in the Opus parameters of the remote descriptions this side
 * applies, which is where browsers take them from). The screen's bandwidth estimate is seeded
 * the same way, in the first remote description a connection applies (`withStartBitrate`).
 *
 * Video is adaptive and per pair (ADR 2). `adjust` (run every `QUALITY_INTERVAL_MS`) reads each
 * screen and camera sender's stats and moves it along its quality ladder (./quality.ts: a
 * screen's steps are built from its capture), applied with `setParameters` to that peer's
 * sender alone. The pairs share this page's uplink, though: an `UplinkBudget` bounds the sum of
 * all the senders' target bitrates and gives each viewer of the screen an equal share (what a
 * viewer's own link can't use goes to the others), a new sender starts at the highest step its
 * share and the others leave room for, a probe up has to fit it, and when most pairs show
 * strain at once the budget drops towards what was being sent and senders step down, cameras
 * first, until the targets fit (ADR 2 addenda). Each side also tells the other which video
 * codecs it can decode (in `hello` and every description), and orders its own senders' codecs
 * best first, AV1 > VP9 > H.264 > VP8, among those (./codecs.ts). A streamer's own order can
 * differ (Firefox sends H.264, a hardware VP9 goes first): the caller chooses it when a share or
 * camera turns on (`chooseStartOrder`) and gives it with `setStartOrder` before the tracks, so no
 * sender is made before it; it is kept for that kind until the kind turns off. A codec
 * preference takes effect in the next offer, which browsers version as they do any other.
 *
 * Local tracks belong to the caller (./local-media.ts): the Mesh never stops them.
 */
import {
  type Capture,
  codecReasonOf,
  localVideoCodecs,
  orderCodecs,
  type StartOrder,
  type VideoCodecs,
  videoMimeTypes,
} from "./codecs";
import {
  type ConnectionEvent,
  type NegotiationStep,
  negotiationEvent,
  pairStateEvent,
  pathEvent,
  pathKey,
  type RestartKind,
  type RestartReason,
  recoveryEvent,
  restartEvent,
} from "./connection-events";
import { hasTurn, type IcePath, icePathOf, isRelayed, STUN_SERVERS } from "./ice";
import {
  aboveCeiling,
  CAMERA_DEFAULT_RUNG,
  CAMERA_LADDER,
  type Claim,
  carryOver,
  codecCap,
  DOWN_SAMPLES,
  FIRST_MINUTE_MS,
  feeds60,
  fitRung,
  freshLadderState,
  heightCap,
  INITIAL_UPLINK,
  type LadderState,
  type Pace,
  paceOf,
  pairCeilings,
  probeClaim,
  probeDue,
  type Rung,
  readSample,
  type StatsSample,
  scaleSteps,
  screenSteps,
  seedBitrate,
  shedFirst,
  step,
  strained,
  UplinkBudget,
} from "./quality";
import { QualityCollector, type RungInfo } from "./quality-collector";
import {
  pathLabel,
  QualityHistory,
  type QualityPoint,
  type StepChange,
  stepChange,
  streamKey,
} from "./quality-history";
import {
  applyNote,
  type ChangeCause,
  causeOf,
  decodeNote,
  NoteSender,
  type PressureCause,
  pressureCause,
  reasonOf,
  type StepBody,
  type StepNote,
} from "./quality-reason";
import {
  type CodecReason,
  type PendingSample,
  type RungReason,
  readStream,
  type StreamReading,
} from "./quality-telemetry";
import type { MediaSlot, SignalPayload } from "./realtime";

/**
 * `connecting` until media can flow (and while an ICE restart runs); then `connected`, or
 * `relayed` through a TURN server; or `failed` when even an ICE restart didn't connect.
 */
export type PeerState = "connecting" | "connected" | "relayed" | "failed";

/** What this page sends everyone, per slot. A missing slot is unchanged; null stops sending it. */
export type LocalTracks = { [S in MediaSlot]?: MediaStreamTrack | null };

/** Someone in the room, as the Mesh needs them. */
export interface MeshParticipant {
  userId: string;
  /**
   * What the server says they share now. Telemetry reports a receive stream only while its peer
   * shares it (ADR 2 addendum); without this everything counts as shared.
   */
  media?: { cam: boolean; share: boolean };
}

/** One remote peer's connection, as the Mesh reports it. */
export interface MeshPeer {
  userId: string;
  /** This side yields in an offer collision (it has the lower user id). */
  polite: boolean;
  state: PeerState;
  /** Their tracks by slot, once negotiated (a track stays, muted, while they send nothing). */
  tracks: Partial<Record<MediaSlot, MediaStreamTrack>>;
}

export type MeshEvent =
  /**
   * A peer's connection state changed (a new peer starts `connecting`). `ice` is its ICE path
   * once it connected (or relays) or failed at ICE; a pair that failed without ever negotiating
   * (a signalling stall, not an ICE failure) has none.
   */
  | { type: "state"; userId: string; state: PeerState; ice?: IcePath }
  /** A peer's track for `slot` arrived. */
  | { type: "track"; userId: string; slot: MediaSlot; track: MediaStreamTrack }
  /** A peer's connection closed (they left, or it restarted: a new `state` follows then). */
  | { type: "closed"; userId: string };

/** How often each video sender's stats are read to adapt its quality. */
export const QUALITY_INTERVAL_MS = 4_000;
/** A reading older than two quality passes no longer says what a sender sends. */
const STALE_READING_MS = 2 * QUALITY_INTERVAL_MS;

/** What the dev overlay shows of one video sender to one peer. */
export interface SlotQuality {
  /** The ladder rung, like `1080p30`. */
  rung: string;
  /** The codec in use, like `video/VP9`, once known. */
  codec?: string;
}
export interface PeerQuality {
  userId: string;
  screen?: SlotQuality;
  cam?: SlotQuality;
}

/**
 * What the quality modal shows of someone else's share (ADR 2 addendum): what this page
 * receives, and the streamer's word about the pair (`note`), absent until they have said.
 */
export interface ViewerQuality {
  side: "viewer";
  /** The streamer. */
  userId: string;
  state: PeerState;
  /** The streamer's step message, once heard. */
  note?: StepNote;
  /** `direct` or `relay · UDP`; unknown before the pair is selected. */
  path?: string;
  /** The last minute, oldest first. */
  points: QualityPoint[];
  changes: StepChange[];
}

/** One viewer of this page's share, in the streamer's modal. */
export interface ViewerRow {
  userId: string;
  state: PeerState;
  /** The step its sender is on and why; absent while its sender hasn't started. */
  note?: StepBody;
  path?: string;
  points: QualityPoint[];
}

/** What the quality modal shows of this page's own share: the upload, and every viewer. */
export interface StreamerQuality {
  side: "streamer";
  /** The uplink budget for video now, bits per second. */
  budget: number;
  /** Whether it was measured under strain; until then it is the starting estimate. */
  budgetMeasured: boolean;
  /** Everything this page sends (`bps`) against the budget (`capBps`), the last minute. */
  uplink: QualityPoint[];
  viewers: ViewerRow[];
  /** Every viewer's step changes, oldest first. */
  changes: (StepChange & { userId: string })[];
}

export type QualityView = ViewerQuality | StreamerQuality;

/** The history key of the uplink as a whole. */
const UPLINK = "uplink";

/** What one pair's pass over its senders showed, for the uplink budget. */
interface PairReading {
  /** Whether a sender past its warm-up showed strain on the network; absent if none was past it. */
  strained?: boolean;
}

/** A video sender being sent, with the pair and ladder state it belongs to. */
interface VideoSender {
  link: Link;
  slot: VideoSlot;
  state: Adaptation;
  sender: RTCRtpSender;
}

/** How long a connection may take to connect (or reconnect) before it gets an ICE restart. */
export const CONNECT_TIMEOUT_MS = 20_000;

export interface MeshOptions {
  /** This user's id: decides who is polite in each pair. */
  selfId: string;
  /** Deliver `payload` to peer `to` (the `signal` message); false if it was dropped (see `resend`). */
  send: (to: string, payload: SignalPayload) => boolean;
  /** The ICE servers (see `setIceServers`). Defaults to `STUN_SERVERS`. */
  iceServers?: RTCIceServer[];
  /** Where negotiation failures are reported. Defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
  /** This browser's video codecs. Defaults to what it reports. For tests. */
  codecs?: VideoCodecs;
  /** The uplink budget to start from, bits per second. Defaults to `INITIAL_UPLINK`. For tests. */
  uplink?: number;
  /**
   * Quality telemetry (ADR 2 addendum): called with a row for each video sender and receiver
   * every `sampleWindowMs`, and for each rung change. Without it nothing is collected.
   */
  onQuality?: (sample: PendingSample) => void;
  /** How long a telemetry window runs. Defaults to `SAMPLE_WINDOW_MS`. */
  sampleWindowMs?: number;
  /**
   * What happens to each pair, for the room timeline (ADR 3 addendum): every connection state,
   * ICE restart or start-over and whether it recovered, the path when the pair connects and when
   * it changes, and negotiation errors. Without it nothing is collected.
   */
  onReport?: (event: ConnectionEvent) => void;
  /** How long a sender's first minute lasts (`paceOf`). Defaults to `FIRST_MINUTE_MS`. For tests. */
  firstMinuteMs?: number;
  /** For tests. */
  RTCPeerConnection?: typeof RTCPeerConnection;
}

const SLOT_KIND: Record<MediaSlot, "audio" | "video"> = {
  mic: "audio",
  cam: "video",
  screen: "video",
  screenAudio: "audio",
};

export type VideoSlot = "screen" | "cam";
const VIDEO_SLOTS: readonly VideoSlot[] = ["screen", "cam"];

/**
 * What differs between the two video slots: where a sender's steps come from, where it starts,
 * how high its capture lets it climb, and whether the budget is divided among this page's
 * viewers (a screen's) or taken as it is (a camera's, which gives way first when the budget is
 * short).
 */
interface SlotPolicy {
  /** The steps a sender of `track` moves along. `sixty` is a screen's verdict on 60 fps. */
  steps(track: MediaStreamTrack, wasSixty?: boolean): { steps: readonly Rung[]; sixty?: boolean };
  /** The highest step a new or resumed sender starts at, if the budget has room for it. */
  start(steps: readonly Rung[]): number;
  /** The highest step the capture can feed. */
  cap(track: MediaStreamTrack, steps: readonly Rung[]): number;
  shared: boolean;
}
const SLOTS: Record<VideoSlot, SlotPolicy> = {
  screen: {
    steps(track, wasSixty) {
      const { width, height, frameRate } = track.getSettings?.() ?? {};
      const sixty = feeds60(frameRate, wasSixty);
      const order =
        degradationFor(track.contentHint) === "maintain-resolution" ? "framerate" : "size";
      return { steps: screenSteps({ width, height, frameRate: sixty ? 60 : 30 }, order), sixty };
    },
    start: (steps) => steps.length - 1,
    cap: (_, steps) => steps.length - 1,
    shared: true,
  },
  cam: {
    steps: () => ({ steps: CAMERA_LADDER }),
    start: () => CAMERA_DEFAULT_RUNG,
    cap: (track, steps) => heightCap(steps, track.getSettings?.().height),
    shared: false,
  },
};
const isVideoSlot = (slot: MediaSlot): slot is VideoSlot => slot in SLOTS;

/** What `track` captures for `slot`, and the bitrate of the step it starts on: what `chooseStartOrder` asks of. */
export function captureOf(slot: VideoSlot, track: MediaStreamTrack): Capture {
  const policy = SLOTS[slot];
  const { width, height, frameRate } = track.getSettings?.() ?? {};
  const { steps } = policy.steps(track);
  return { width, height, frameRate, bitrate: (steps[policy.start(steps)] as Rung).maxBitrate };
}
/**
 * The steps a sender moves along with the caps of the codec it actually sends (`scaleSteps`):
 * every bitrate decision (the encoding, the budget, probes, telemetry) reads these, never the
 * bare `state.steps`, whose `maxBitrate` is the AV1 and VP9 cap.
 */
const ladderOf = (state: Adaptation) => scaleSteps(state.steps, state.codec);
/** Step `rung` of a sender's ladder, with its cap for the codec in use. */
const stepAt = (state: Adaptation, rung: number): Rung => {
  const step = state.steps[rung] as Rung;
  return { ...step, maxBitrate: codecCap(step, state.codec) };
};
/** The step a sender is on, and its label and target bitrate for telemetry. */
const stepOf = (state: Adaptation) => stepAt(state, state.rung);
const rungInfo = ({ label, maxBitrate }: Rung): RungInfo => ({ label, maxBitrate });
const sameSteps = (a: readonly Rung[], b: readonly Rung[]) =>
  a.length === b.length && a.every((rung, i) => rung.label === b[i]?.label);
/** `state` starts over at `rung` of `steps`: a new window, but what it learned of its link stays. */
const restart = (state: Adaptation, rung: number, steps = state.steps) =>
  Object.assign(state, freshLadderState(rung), {
    steps,
    backoff: state.backoff,
    limited: state.limited,
  });

/** Created with every connection, so a pair connects before anyone unmutes. */
const EAGER_SLOTS: readonly MediaSlot[] = ["mic"];

/** Share audio's bitrate: tab or system sound, in stereo (ADR 2 addendum). */
export const SHARE_AUDIO_BITRATE = 128_000;

/**
 * What a screen sender gives up first under pressure, by its track's `contentHint`: frames
 * for detail and text (sharp resolution), resolution for motion (smooth frames).
 */
export function degradationFor(contentHint: string): RTCDegradationPreference {
  return contentHint === "detail" || contentHint === "text"
    ? "maintain-resolution"
    : "maintain-framerate";
}

/**
 * Whether `sdp` is the description `previous` was again. A description sent again carries the
 * ICE candidates gathered since, so its text differs; its origin line (session id and version,
 * which a new description bumps) does not.
 */
export function isSameOffer(sdp: string | undefined, previous: string | undefined): boolean {
  if (sdp === undefined || previous === undefined) return false;
  const origin = (text: string) => /^o=.*$/m.exec(text)?.[0];
  const o = origin(sdp);
  return o === undefined ? sdp === previous : o === origin(previous);
}

/**
 * `sdp` with `edit` applied, in place, to the lines of each m-section whose mid is in `mids`
 * (the other sections, and the session part, are left as they are).
 */
function editSections(
  sdp: string,
  mids: ReadonlySet<string>,
  edit: (lines: string[]) => void,
): string {
  if (mids.size === 0) return sdp;
  const [session = "", ...media] = sdp.split(/\r\n(?=m=)/);
  const sections = media.map((section) => {
    const lines = section.split("\r\n");
    const mid = lines.find((line) => line.startsWith("a=mid:"))?.slice("a=mid:".length);
    if (mid === undefined || !mids.has(mid)) return section;
    edit(lines);
    return lines.join("\r\n");
  });
  return [session, ...sections].join("\r\n");
}

/**
 * `sdp` with stereo Opus at `SHARE_AUDIO_BITRATE` in the m-sections whose mid is in `mids`
 * (this side's share audio): a sender encodes what the other side's description asks for.
 */
export function withStereoOpus(sdp: string, mids: ReadonlySet<string>): string {
  return editSections(sdp, mids, (lines) => {
    const opus = lines
      .map((line) => /^a=rtpmap:(\d+) opus\/48000/i.exec(line)?.[1])
      .find((pt) => pt !== undefined);
    if (opus === undefined) return;
    const wanted = `stereo=1;maxaveragebitrate=${SHARE_AUDIO_BITRATE}`;
    const fmtp = `a=fmtp:${opus} `;
    const at = lines.findIndex((line) => line.startsWith(fmtp));
    if (at === -1) {
      lines.splice(
        lines.findIndex((line) => line.startsWith(`a=rtpmap:${opus} `)) + 1,
        0,
        fmtp + wanted,
      );
    } else {
      const kept = (lines[at] as string)
        .slice(fmtp.length)
        .split(";")
        .filter((param) => param && !/^(stereo|maxaveragebitrate)=/.test(param.trim()));
      lines[at] = fmtp + [...kept, wanted].join(";");
    }
  });
}

/** Video codecs that carry media; the others in a video m-section (rtx, red, ulpfec) repair it. */
const MEDIA_CODEC = /^a=rtpmap:(\d+) (?:VP8|VP9|AV1|H264|H265)\//i;

/**
 * `sdp` with Chromium's `x-google-start-bitrate` (`bitrate` bits per second, written in kbps)
 * on every video codec of the m-sections whose mid is in `mids` (this side's screen): the
 * sender's bandwidth estimate starts there instead of at 300 kbps. Like `withStereoOpus` it is
 * for the remote description this side applies, because a sender's encoder and estimate are
 * configured from what the other side's description asks for. Firefox ignores the parameter.
 *
 * The value applies to the whole connection (it feeds the connection's estimate, not one
 * stream's), and in this mesh a connection is one pair. LiveKit seeds its estimate the same way
 * (client-sdk-android PR #973, https://github.com/livekit/client-sdk-android/pull/973).
 *
 * Existing parameters are kept and the key is never doubled: a codec's old value is replaced.
 * A codec with no fmtp line gets one (VP8 has none in Chromium, and may be the one in use);
 * retransmission and redundancy formats are left alone.
 */
export function withStartBitrate(sdp: string, mids: ReadonlySet<string>, bitrate: number): string {
  const kbps = Math.floor(bitrate / 1_000);
  if (!(kbps > 0)) return sdp;
  return editSections(sdp, mids, (lines) => {
    if (!lines[0]?.startsWith("m=video ")) return;
    const wanted = `x-google-start-bitrate=${kbps}`;
    const codecs = lines.flatMap((line) => MEDIA_CODEC.exec(line)?.[1] ?? []);
    for (const pt of codecs) {
      const fmtp = `a=fmtp:${pt} `;
      const at = lines.findIndex((line) => line.startsWith(fmtp));
      if (at === -1) {
        lines.splice(
          lines.findIndex((line) => line.startsWith(`a=rtpmap:${pt} `)) + 1,
          0,
          fmtp + wanted,
        );
      } else {
        const kept = (lines[at] as string)
          .slice(fmtp.length)
          .split(";")
          .filter((param) => param && !param.trim().startsWith("x-google-start-bitrate="));
        lines[at] = fmtp + [...kept, wanted].join(";");
      }
    }
  });
}

/**
 * The codec the sender of the m-section whose mid is in `mids` will send, from the description
 * the other side wrote: the first payload type on its `m=video` line that carries media (not rtx,
 * red or ulpfec), as the MIME type its `a=rtpmap` names, like `video/H264`. Undefined if there is
 * none. The other side lists its codecs in the order it wants them.
 */
export function sentCodecOf(sdp: string, mids: ReadonlySet<string>): string | undefined {
  let codec: string | undefined;
  editSections(sdp, mids, (lines) => {
    const types = lines[0]?.startsWith("m=video ") ? lines[0].split(" ").slice(3) : [];
    const names = new Map(
      lines.flatMap((line) => {
        const rtpmap = MEDIA_CODEC.exec(line);
        return rtpmap ? [[rtpmap[1], /^a=rtpmap:\d+ ([^/]+)\//i.exec(line)?.[1]] as const] : [];
      }),
    );
    const first = types.find((type) => names.has(type));
    const name = first === undefined ? undefined : names.get(first);
    if (name) codec = `video/${name}`;
  });
  return codec;
}

const newSession = () => Math.random().toString(36).slice(2, 12);

type Step =
  | Omit<Extract<SignalPayload, { kind: "description" }>, "session" | "peerSession">
  | Omit<Extract<SignalPayload, { kind: "candidate" }>, "session" | "peerSession">
  | Omit<Extract<SignalPayload, { kind: "visibility" }>, "session" | "peerSession">
  | Omit<Extract<SignalPayload, { kind: "quality" }>, "session" | "peerSession">;
type DescriptionStep = Extract<Step, { kind: "description" }>;

/**
 * One video sender's place on its quality ladder (`rung` is the one wanted, see `#tune`). A
 * screen's `steps` are built from its capture (`screenSteps`), a camera's are `CAMERA_LADDER`.
 */
interface Adaptation extends LadderState {
  steps: readonly Rung[];
  /** A screen's verdict on whether its capture feeds 60 fps (`feeds60`). */
  sixty?: boolean;
  /** Readings taken since it started, warm-up included. */
  readings: number;
  /**
   * When the sender started (epoch ms): a new share, or a new viewer of one. A first minute from
   * here paces the controller faster (`paceOf`). Steps built again, a probe or a step down leave
   * it alone.
   */
  startedAt: number;
  /**
   * Why the sender was given its codec: the reason of the start order its kind was given,
   * until the codec switch (ADR 2, codecs addendum) sets another. Its telemetry rows say it
   * only while the codec sent is the one it is about (`codecReasonOf`).
   */
  codecReason: CodecReason;
  /** The latest reading (the next one's `sendBitrate` is measured from it). */
  last?: StatsSample;
  /**
   * The codec it sends, from its negotiated parameters and then its stats: the caps of its
   * steps are scaled by it (`ladderOf`).
   */
  codec?: string;
  /** What the pressure was down to when it last stepped down under it (`limited` says it holds). */
  cause?: PressureCause;
}

interface Link {
  userId: string;
  polite: boolean;
  pc: RTCPeerConnection;
  /** This side's id for `pc`, sent with every step. */
  session: string;
  /** The peer's id for its connection to us, from its first step. */
  remoteSession?: string;
  state: PeerState;
  /** This side sends over its own transceivers (the polite side waits for the first offer). */
  started: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** This side's transceivers, by the slot each sends. */
  own: Map<MediaSlot, RTCRtpTransceiver>;
  /** Which slot each of the peer's transceivers carries, by `mid`. */
  remoteSlots: Map<string, MediaSlot>;
  /** The peer's description this side applied last, as sent (before `withStereoOpus`). */
  remoteSdp?: string;
  /** The pending offer was dropped by `send` (`resend` sends what is pending then). */
  offerUnsent: boolean;
  /** The answer `send` dropped; it goes before any offer after it. */
  answerUnsent?: DescriptionStep;
  /** A quality pass over this peer's senders is running (see `adjust`). */
  adjusting: boolean;
  /** Slots the peer isn't showing: sent to it as no track. */
  paused: Set<MediaSlot>;
  tracks: Partial<Record<MediaSlot, MediaStreamTrack>>;
  /** Incoming steps, handled one at a time. */
  queue: Promise<void>;
  /** It had its ICE restart since it last connected. */
  restarted: boolean;
  /** It replaces a connection that never negotiated (see `#failed`). */
  startedOver: boolean;
  /** The restart or start-over that hasn't yet connected or given up, for the room timeline. */
  attempt?: { how: RestartKind; since: number };
  /** The path last reported (`pathKey`), to see when it changes. */
  pathKey?: string;
  /** The connection state last reported, so none is reported twice running. */
  stateReported?: string;
  /** A refused candidate was reported since the last description was applied. */
  candidateFailed?: boolean;
  /** A path read for the room timeline is under way (`#checkPath`). */
  pathReading?: boolean;
  /** The video codecs the peer can decode, once it has said. */
  remoteCodecs?: string[];
  /** Where each of this side's video senders is on its ladder. */
  quality: Partial<Record<VideoSlot, Adaptation>>;
  /** Each video sender's parameter changes, one at a time. */
  tuning: Partial<Record<VideoSlot, Promise<void>>>;
  /** Runs out while it is connecting (`CONNECT_TIMEOUT_MS`). */
  connectTimer?: ReturnType<typeof setTimeout>;
  /** When this side tells the peer the step its screen is on, and why (the quality modal). */
  notes: NoteSender;
  /** The step of this side's screen sender that history last noted, to see when it changes. */
  stepNoted?: string;
  /** What made the screen sender's latest step change; it goes with every message till the next. */
  stepCause?: ChangeCause;
}

export class Mesh {
  readonly #selfId: string;
  readonly #send: MeshOptions["send"];
  #iceServers: RTCIceServer[];
  readonly #log: (message: string, error?: unknown) => void;
  readonly #RTCPeerConnection: typeof RTCPeerConnection;
  readonly #codecs: VideoCodecs | undefined;
  /** Per video slot, the order its codecs are offered in while it is on (absent: the normal one). */
  readonly #codecOrders: Partial<Record<VideoSlot, StartOrder>> = {};
  readonly #firstMinuteMs: number;
  /** What all the video senders' targets may add up to (their sum is `#committed`). */
  readonly #budget: UplinkBudget;
  /** What `setParameters` last gave each screen sender, for browsers that don't report it. */
  readonly #degradation = new WeakMap<RTCRtpSender, RTCDegradationPreference>();
  /** Undefined without `onQuality`. */
  readonly #telemetry: QualityCollector | undefined;
  readonly #onReport: MeshOptions["onReport"];
  readonly #links = new Map<string, Link>();
  readonly #listeners = new Set<(event: MeshEvent) => void>();
  readonly #local: Partial<Record<MediaSlot, MediaStreamTrack | null>> = {};
  /** Per peer, whether this page shows each slot of theirs it has said (kept across reconnects). */
  readonly #shown = new Map<string, Map<MediaSlot, boolean>>();
  /** Per peer, what the server last said they share (from `join`); telemetry follows it. */
  readonly #media = new Map<string, { cam: boolean; share: boolean }>();
  /** The last minute of each screen stream, for the quality modal. */
  readonly #history = new QualityHistory();
  /** Per streamer, what they last told this page about the step they send it and why. */
  readonly #notes = new Map<string, StepNote>();
  #closed = false;
  #adjustTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: MeshOptions) {
    this.#selfId = options.selfId;
    this.#send = options.send;
    this.#iceServers = options.iceServers ?? STUN_SERVERS;
    this.#log = options.log ?? ((message, error) => console.warn(`[mesh] ${message}`, error));
    this.#RTCPeerConnection = options.RTCPeerConnection ?? RTCPeerConnection;
    this.#codecs = options.codecs ?? localVideoCodecs();
    this.#firstMinuteMs = options.firstMinuteMs ?? FIRST_MINUTE_MS;
    this.#budget = new UplinkBudget(options.uplink ?? INITIAL_UPLINK);
    this.#onReport = options.onReport;
    if (options.onQuality) {
      this.#telemetry = new QualityCollector({
        emit: options.onQuality,
        windowMs: options.sampleWindowMs,
        startedAt: ({ peerId, slot }) => this.#links.get(peerId)?.quality[slot]?.startedAt,
        codecReason: ({ peerId, slot }) => {
          const state = this.#links.get(peerId)?.quality[slot];
          return state && codecReasonOf(state.codecReason, state.codec);
        },
      });
    }
  }

  /**
   * The room's people now (the snapshot, then after every change; this user may be among them):
   * connect to newcomers, close connections to anyone gone.
   */
  join(participants: readonly MeshParticipant[]): void {
    if (this.#closed) return;
    const present = new Set<string>();
    for (const participant of participants) {
      if (participant.userId === this.#selfId) continue;
      present.add(participant.userId);
      if (participant.media) {
        this.#media.set(participant.userId, participant.media);
        this.#reportSharing(participant.userId);
      }
      if (!this.#links.has(participant.userId)) this.#open(participant.userId);
    }
    for (const userId of [...this.#links.keys()]) if (!present.has(userId)) this.peerLeft(userId);
  }

  /** Someone left the room (or was kicked): close their connection. */
  peerLeft(userId: string): void {
    const link = this.#links.get(userId);
    if (!link) return;
    this.#links.delete(userId);
    this.#media.delete(userId);
    this.#telemetry?.forget(userId);
    this.#forgetReceived(userId);
    this.#history.forget(streamKey("send", userId));
    this.#shut(link);
    this.#emit({ type: "closed", userId });
  }

  /** A `signal` from `from`, relayed by the server. */
  receive(from: string, payload: SignalPayload): void {
    if (this.#closed || from === this.#selfId) return;
    let link = this.#links.get(from);
    // For a connection of ours that has since been closed or replaced.
    if ("peerSession" in payload && payload.peerSession && payload.peerSession !== link?.session) {
      return;
    }
    const peerStartedOver = !!link?.remoteSession && link.remoteSession !== payload.session;
    if (peerStartedOver) {
      // They started over (a reload, a takeover): so does this side.
      this.peerLeft(from);
      link = undefined;
    }
    // The server only relays from people in the room, and ahead of their `left`. An offer is
    // the first word this side needs; anything else means theirs may have been lost.
    const offer = payload.kind === "description" && payload.description.type === "offer";
    if (!link) {
      link = this.#open(from, !offer);
      if (peerStartedOver) this.#began(link, "start_over", "peer");
    }
    link.remoteSession = payload.session;
    if ((payload.kind === "hello" || payload.kind === "description") && payload.codecs) {
      link.remoteCodecs = payload.codecs;
      for (const slot of VIDEO_SLOTS) {
        const transceiver = link.own.get(slot);
        if (transceiver) this.#prefer(link, slot, transceiver);
      }
    }
    if (payload.kind === "hello") {
      // They have no offer from this side: it went while they were away (their reconnect
      // grace), so send it again. It carries the candidates gathered so far.
      if (link.pc.signalingState === "have-local-offer") this.#sendDescription(link);
      return;
    }
    if (payload.kind === "quality") {
      // Display only, so it skips the negotiation queue. Not from someone the server says isn't
      // sharing: a message that arrives after their share ended must not outlive it.
      const note = decodeNote(payload);
      if (note && this.#media.get(from)?.share !== false) this.#hear(from, note);
      return;
    }
    if (payload.kind === "visibility") {
      if (payload.visible === !link.paused.has(payload.slot)) return;
      if (payload.visible) link.paused.delete(payload.slot);
      else link.paused.add(payload.slot);
      const transceiver = link.own.get(payload.slot);
      if (transceiver) this.#sendSlot(link, payload.slot, transceiver);
      return;
    }
    const current = link;
    current.queue = current.queue
      .then(() => this.#handle(current, payload))
      .catch((error: unknown) => this.#log(`signalling with ${from} failed`, error));
  }

  /**
   * Send these tracks to everyone (now and to anyone who joins later), per slot; null stops
   * sending a slot. Nothing is renegotiated for a slot sent before.
   */
  setLocalTracks(tracks: LocalTracks): void {
    if (this.#closed) return;
    for (const [slot, track] of Object.entries(tracks) as [MediaSlot, MediaStreamTrack | null][]) {
      if (track === undefined) continue;
      if (!track && isVideoSlot(slot) && this.#codecOrders[slot]) {
        delete this.#codecOrders[slot];
        this.#preferAll(slot);
      }
      // A new capture starts at its ladder's default again.
      if (track && track !== this.#local[slot] && isVideoSlot(slot)) {
        for (const link of this.#links.values()) {
          delete link.quality[slot];
          this.#telemetry?.reset({ peerId: link.userId, slot, direction: "send" });
        }
        this.#watchQuality();
      }
      // A share that ends, or a new capture, is a new stream: the viewers hear about it afresh.
      if (slot === "screen" && track !== this.#local.screen) this.#endShare();
      this.#local[slot] = track;
      for (const link of this.#links.values()) {
        // It gets the local tracks when it starts.
        if (!link.started) continue;
        const transceiver = link.own.get(slot);
        if (transceiver) this.#sendSlot(link, slot, transceiver);
        else if (track) this.#addSlot(link, slot);
      }
    }
  }

  /**
   * The order to offer `slot`'s codecs in from now on, for as long as the slot is on (turning it
   * off forgets it): give it before the slot's tracks, so its first sender has it. Transceivers
   * the slot has already take it too.
   */
  setStartOrder(slot: VideoSlot, order: StartOrder): void {
    if (this.#closed) return;
    this.#codecOrders[slot] = order;
    this.#preferAll(slot);
  }

  /** Offer `slot`'s codecs again on every transceiver it already has, in its order now. */
  #preferAll(slot: VideoSlot): void {
    for (const link of this.#links.values()) {
      const transceiver = link.own.get(slot);
      if (transceiver) this.#prefer(link, slot, transceiver);
    }
  }

  /**
   * Send again the descriptions `send` dropped (an offer or answer meant for a peer while this
   * page's socket was reconnecting). Call it once the socket is back in the room, which is when
   * the server relays this page's signalling again. A no-op for peers with nothing waiting.
   */
  resend(): void {
    if (this.#closed) return;
    for (const link of this.#links.values()) {
      this.#flush(link);
      // A step message dropped the same way goes out again (it was never marked delivered).
      this.#tell(link);
    }
  }

  /**
   * Use these ICE servers from now on (fresh TURN credentials): for new connections, and for
   * ICE restarts of the current ones. When TURN arrives after a start on STUN alone (fetching
   * the credentials failed at first), pairs that failed meanwhile restart ICE: they may relay.
   */
  setIceServers(iceServers: RTCIceServer[]): void {
    const gotTurn = !hasTurn(this.#iceServers) && hasTurn(iceServers);
    this.#iceServers = iceServers;
    for (const link of this.#links.values()) {
      this.#configure(link);
      if (gotTurn && link.state === "failed" && link.pc.remoteDescription) {
        this.#restartIce(link, "turn");
      }
    }
  }

  /** Start over with `userId` (after `failed`): a new connection, and they start over too. */
  retry(userId: string): void {
    if (this.#closed || !this.#links.has(userId)) return;
    this.#startOver(userId, "retry");
  }

  /**
   * Whether this page shows `userId`'s `slot` track now. Everything counts as shown until said
   * otherwise; a hidden track is paused towards this page. The peer is told as soon as it has
   * spoken to this side, and again whenever the pair connects.
   */
  setVisible(userId: string, slot: MediaSlot, visible: boolean): void {
    if (this.#closed || userId === this.#selfId) return;
    const shown = this.#shown.get(userId) ?? new Map<MediaSlot, boolean>();
    if (shown.get(slot) === visible) return;
    shown.set(slot, visible);
    this.#shown.set(userId, shown);
    this.#reportSharing(userId);
    const link = this.#links.get(userId);
    if (link?.remoteSession) this.#signal(link, { kind: "visibility", slot, visible });
  }

  /** Everyone this page has a connection to. */
  peers(): MeshPeer[] {
    return [...this.#links.values()].map((link) => ({
      userId: link.userId,
      polite: link.polite,
      state: link.state,
      tracks: { ...link.tracks },
    }));
  }

  /**
   * Whether `userId`'s `slot` media is arriving: a packet came within the last 10 seconds.
   * Their track stays, unmuted, while they send nothing (e.g. a share without audio), so this
   * is what tells.
   */
  receiving(userId: string, slot: MediaSlot): boolean {
    const link = this.#links.get(userId);
    const track = link?.tracks[slot];
    if (!link || !track) return false;
    const receiver = link.pc.getReceivers().find((r) => r.track === track);
    // Browsers list a source until 10 seconds after its last packet.
    return (receiver?.getSynchronizationSources().length ?? 0) > 0;
  }

  /** Each connection's `getStats()`, by peer (for quality control and ICE logging, #37/#38). */
  async stats(): Promise<Map<string, RTCStatsReport>> {
    const links = [...this.#links.values()];
    const reports = await Promise.all(links.map((link) => link.pc.getStats()));
    return new Map(links.map((link, i) => [link.userId, reports[i] as RTCStatsReport]));
  }

  /**
   * Read every video sender's stats and move it along its ladder (run every
   * `QUALITY_INTERVAL_MS` while something is sent; public for tests). Each peer's senders adapt
   * on their own connection's stats, so a viewer on a bad link doesn't degrade the others. Each
   * peer's pass is guarded on its own too: one whose stats read hangs is skipped until it
   * returns, and the other peers carry on.
   */
  async adjust(): Promise<void> {
    const links = [...this.#links.values()];
    const readings = await Promise.all(links.map((link) => this.#adjustLink(link)));
    // A pair skipped this pass (its last read hasn't returned) has no say; what it sends counts.
    const judged = readings.filter((reading) => reading?.strained !== undefined);
    if (judged.length > 0) {
      let sent = 0;
      for (const { link, state } of this.#videoSenders()) {
        if (this.#live(link)) sent += state.last?.sendBitrate ?? 0;
      }
      this.#budget.observe({
        pairs: judged.length,
        strainedPairs: judged.filter((reading) => reading?.strained).length,
        sent,
      });
    }
    this.#fitBudget();
    // Anything the pass changed (a step, its cost or why) is told to the viewers it concerns.
    const ceilings = this.#viewerCeilings();
    for (const link of this.#links.values()) this.#tell(link, ceilings);
    this.#recordUplink();
  }

  /**
   * What the quality modal shows of `userId`'s screen share (ADR 2 addendum), from the last
   * minute the Mesh has kept of it: someone else's, as a viewer sees it; or this page's own, with
   * every viewer. Undefined if there is nothing to show (no such peer, or no share of this
   * page's own).
   */
  streamQuality(userId: string): QualityView | undefined {
    if (userId === this.#selfId) return this.#localQuality();
    const link = this.#links.get(userId);
    if (!link) return undefined;
    const key = streamKey("recv", userId);
    const note = this.#notes.get(userId);
    const path = pathLabel(this.#history.latest(key));
    return {
      side: "viewer",
      userId,
      state: link.state,
      ...(note && { note }),
      ...(path && { path }),
      points: this.#history.points(key),
      changes: this.#history.changes(key),
    };
  }

  /**
   * Read the pair now, ahead of the next quality pass, so a modal that is open stays current
   * (call it about once a second): one `getStats` for the receiver of `userId`'s screen, or, for
   * this page's own, one for each viewer's screen sender.
   */
  async refreshQuality(userId: string): Promise<void> {
    if (this.#closed) return;
    if (userId !== this.#selfId) {
      const link = this.#links.get(userId);
      if (link) await this.#refreshReceived(link);
      return;
    }
    await Promise.all([...this.#links.values()].map((link) => this.#refreshSent(link)));
    this.#recordUplink();
  }

  /** The uplink budget and what all the video senders' targets add up to. For tests. */
  uplink(): { budget: number; targeted: number } {
    return { budget: this.#budget.limit, targeted: this.#committed() };
  }

  /** Each peer's current rung and codec, per video sender that is sending (for the dev overlay). */
  quality(): PeerQuality[] {
    return [...this.#links.values()].map((link) => {
      const peer: PeerQuality = { userId: link.userId };
      for (const slot of VIDEO_SLOTS) {
        const state = link.quality[slot];
        if (!state || !link.own.get(slot)?.sender.track) continue;
        peer[slot] = {
          rung: stepOf(state).label,
          ...(state.codec && { codec: state.codec }),
        };
      }
      return peer;
    });
  }

  /** Remote tracks and connection states as they change. Returns an unsubscribe function. */
  subscribe(listener: (event: MeshEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Close every connection (leaving the room). The Mesh is done after this. */
  close(): void {
    if (this.#closed) return;
    for (const userId of [...this.#links.keys()]) this.peerLeft(userId);
    this.#closed = true;
    clearInterval(this.#adjustTimer);
    this.#listeners.clear();
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Connect to `userId`; a polite side says `hello` unless `greet` is false (it has an offer).
   * `startedOver`: it replaces one that never negotiated (its automatic start-over is used).
   */
  #open(userId: string, greet = true, startedOver = false): Link {
    const pc = new this.#RTCPeerConnection({ iceServers: this.#iceServers });
    const link: Link = {
      userId,
      // Perfect negotiation needs exactly one polite side per pair: compare user ids.
      polite: this.#selfId < userId,
      pc,
      session: newSession(),
      state: "connecting",
      started: false,
      makingOffer: false,
      ignoreOffer: false,
      offerUnsent: false,
      adjusting: false,
      own: new Map(),
      remoteSlots: new Map(),
      paused: new Set(),
      tracks: {},
      quality: {},
      tuning: {},
      queue: Promise.resolve(),
      restarted: false,
      startedOver,
      notes: new NoteSender(),
    };
    this.#links.set(userId, link);
    pc.onnegotiationneeded = () => void this.#offer(link);
    pc.onicecandidate = ({ candidate }) => {
      // End-of-candidates isn't sent: ICE completes without it.
      if (candidate) this.#signal(link, { kind: "candidate", candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ transceiver, track }) => this.#track(link, transceiver, track);
    pc.onconnectionstatechange = () => this.#stateChanged(link);
    this.#emit({ type: "state", userId, state: link.state });
    this.#reportState(link, "connecting");
    this.#waitToConnect(link);
    // What the pair receives is measured too (telemetry), whether or not this page sends.
    if (this.#telemetry) this.#watchQuality();
    // The impolite side makes the first offer; the polite side starts once it has answered.
    if (!link.polite) this.#start(link);
    else if (greet) {
      this.#send(userId, { kind: "hello", session: link.session, ...this.#decodable() });
    }
    return link;
  }

  /** Start sending: the eager slots, and every local track there is. */
  #start(link: Link): void {
    if (link.started) return;
    link.started = true;
    for (const slot of EAGER_SLOTS) this.#addSlot(link, slot);
    for (const [slot, track] of Object.entries(this.#local) as [MediaSlot, MediaStreamTrack][]) {
      if (track && !link.own.has(slot)) this.#addSlot(link, slot);
    }
  }

  /** What to send `link`'s peer for `slot`: the local track, unless they aren't showing it. */
  #outgoing(link: Link, slot: MediaSlot): MediaStreamTrack | null {
    return link.paused.has(slot) ? null : (this.#local[slot] ?? null);
  }

  /** Start sending `slot` to `link`'s peer over a transceiver of its own (renegotiates). */
  #addSlot(link: Link, slot: MediaSlot): void {
    const track = this.#outgoing(link, slot);
    const transceiver = link.pc.addTransceiver(track ?? SLOT_KIND[slot], {
      direction: "sendonly",
      ...(slot === "screenAudio" && { sendEncodings: [{ maxBitrate: SHARE_AUDIO_BITRATE }] }),
    });
    link.own.set(slot, transceiver);
    if (isVideoSlot(slot)) this.#prefer(link, slot, transceiver);
    this.#tune(link, slot, transceiver.sender);
  }

  /**
   * Offer `transceiver`'s codecs best first, in the order chosen for `slot`, among those the
   * peer can decode (once known).
   */
  #prefer(link: Link, slot: VideoSlot, transceiver: RTCRtpTransceiver): void {
    if (!this.#codecs || !transceiver.setCodecPreferences) return;
    try {
      transceiver.setCodecPreferences(
        orderCodecs(this.#codecs.send, link.remoteCodecs, this.#codecOrders[slot]),
      );
    } catch (error) {
      this.#log(`choosing codecs for ${link.userId} failed`, error);
    }
  }

  /** Swap what `slot`'s transceiver sends `link`'s peer (no renegotiation). */
  #sendSlot(link: Link, slot: MediaSlot, transceiver: RTCRtpTransceiver): void {
    transceiver.sender
      .replaceTrack(this.#outgoing(link, slot))
      .then(() => {
        // A resumed or replaced track: the readings so far were of something else. It comes
        // back at the highest step the budget has room for now, like a new pair.
        const state = isVideoSlot(slot) ? link.quality[slot] : undefined;
        if (state && isVideoSlot(slot)) {
          const policy = SLOTS[slot];
          const track = transceiver.sender.track;
          // Like a new pair: the highest step its allowance and its capture leave it.
          const rung = track
            ? fitRung(
                ladderOf(state),
                this.#allowance(link, slot),
                Math.min(policy.start(state.steps), policy.cap(track, state.steps)),
              )
            : state.rung;
          this.#rungChanged(link, slot, stepOf(state), stepAt(state, rung), "resume");
          Object.assign(state, freshLadderState(rung), { readings: 0, last: undefined });
          this.#telemetry?.reset({ peerId: link.userId, slot, direction: "send" });
        }
        this.#tune(link, slot, transceiver.sender);
      })
      .catch((error: unknown) => this.#log(`sending ${slot} to ${link.userId} failed`, error));
  }

  /**
   * Make a video sender encode at its wanted rung (bitrate, frame rate, scale down from the
   * capture) and, for a screen, its degradation preference (from its track's content hint, i.e.
   * the room kind). Changes to one sender go one at a time; what is applied is compared with
   * what is wanted on every `adjust` pass, so a change that was refused (or a capture that has
   * since been resized) is made again.
   */
  #tune(link: Link, slot: MediaSlot, sender: RTCRtpSender): void {
    if (!isVideoSlot(slot)) return;
    link.tuning[slot] = (link.tuning[slot] ?? Promise.resolve())
      .then(() => this.#applyRung(link, slot, sender))
      // A new screen sender has its step now (and a resumed one its new step): say so.
      .then(() => {
        if (slot === "screen") this.#tell(link);
      })
      .catch((error: unknown) => this.#log(`tuning the ${slot} to ${link.userId} failed`, error));
  }

  async #applyRung(link: Link, slot: VideoSlot, sender: RTCRtpSender): Promise<void> {
    const track = sender.track;
    if (!track || !this.#current(link)) return;
    const rung = stepOf(this.#adaptation(link, slot, track));
    const parameters = sender.getParameters();
    const [first, ...others] = parameters.encodings ?? [];
    if (!first) return;
    const height = track.getSettings?.().height;
    const wanted: RTCRtpEncodingParameters = {
      maxBitrate: rung.maxBitrate,
      maxFramerate: rung.frameRate,
      ...(height && { scaleResolutionDownBy: Math.max(1, height / rung.height) }),
    };
    // A camera keeps whatever it has. A browser that doesn't report its degradation preference
    // (Firefox, probably Safari) is taken to have what was last set, or it would never match.
    const degradationPreference = slot === "screen" ? degradationFor(track.contentHint) : undefined;
    const unchanged =
      (degradationPreference === undefined ||
        (parameters.degradationPreference ?? this.#degradation.get(sender)) ===
          degradationPreference) &&
      Object.entries(wanted).every(([key, value]) => first[key as keyof typeof first] === value);
    if (unchanged) return;
    await sender.setParameters({
      ...parameters,
      encodings: [{ ...first, ...wanted }, ...others],
      ...(degradationPreference && { degradationPreference }),
    });
    if (degradationPreference) this.#degradation.set(sender, degradationPreference);
  }

  /**
   * The step a new `slot` sender starts on: the highest its allowance and capture leave it, on
   * the caps of the `codec` it is known to send (if any).
   */
  #startRung(
    link: Link,
    slot: VideoSlot,
    track: MediaStreamTrack,
    steps: readonly Rung[],
    codec?: string,
  ): number {
    const policy = SLOTS[slot];
    const top = Math.min(policy.start(steps), policy.cap(track, steps));
    return fitRung(scaleSteps(steps, codec), this.#allowance(link, slot), top);
  }

  /**
   * `slot`'s ladder state for `link`. A new sender starts at the highest step that its allowance
   * (its pair's ceiling and the room in the budget) and its capture leave it. A screen whose
   * steps are no longer the same (a window resized, or its frame rate became or stopped being
   * 60) has them built again and carries over to the step of the same size, or for a new size
   * the nearest below what it cost; a rebuild that leaves it on the same step changes nothing
   * else.
   */
  #adaptation(link: Link, slot: VideoSlot, track: MediaStreamTrack): Adaptation {
    const policy = SLOTS[slot];
    let state = link.quality[slot];
    const built = policy.steps(track, state?.sixty);
    // The codec the sender is negotiated to send, once it is (a new sender has none until its
    // description is applied: the first tune after it finds it); its first stats reading follows.
    // Only where negotiation is settled: with a remote offer applied and no answer yet, the
    // parameters list the browser's own capabilities (VP8 first), not what will be sent.
    const codec =
      link.pc.signalingState === "stable"
        ? videoMimeTypes(link.own.get(slot)?.sender.getParameters().codecs ?? [])[0]
        : undefined;
    if (!state) {
      const rung = this.#startRung(link, slot, track, built.steps, codec);
      state = {
        ...freshLadderState(rung),
        ...built,
        readings: 0,
        startedAt: Date.now(),
        codecReason: this.#codecOrders[slot]?.reason ?? "preferred",
        ...(codec && { codec }),
      };
      link.quality[slot] = state;
    } else if (!state.codec && codec) {
      state.codec = codec;
      // Nothing was read of it yet, so it started on caps that were not its codec's: start it
      // again on the scaled ones, where it is not on the step they allow.
      if (state.readings === 0) {
        const rung = this.#startRung(link, slot, track, state.steps, codec);
        if (rung !== state.rung) restart(state, rung);
      }
    }
    if (state && !sameSteps(state.steps, built.steps)) {
      const from = stepOf(state);
      // The cost `from` had, and the steps' own, are both at the codec in use.
      const scaled = scaleSteps(built.steps, state.codec);
      const rung = carryOver(from, scaled);
      const to = scaled[rung] as Rung;
      if (to.label === from.label) Object.assign(state, { steps: built.steps, rung });
      else {
        this.#rungChanged(link, slot, from, to, "capture");
        restart(state, rung, built.steps);
      }
    }
    state.sixty = built.sixty;
    return state;
  }

  /**
   * Everyone this page's screen is for: each connection that hasn't failed and isn't hiding the
   * screen, started or not (its share is kept for it).
   */
  #viewers(): Link[] {
    if (!this.#local.screen) return [];
    return [...this.#links.values()].filter(
      (link) => link.state !== "failed" && !link.paused.has("screen"),
    );
  }

  /** What `link`'s screen sender targets, 0 if it has none yet. */
  #screenTarget(link: Link): number {
    const screen = link.quality.screen;
    return screen && link.own.get("screen")?.sender.track ? stepOf(screen).maxBitrate : 0;
  }

  /** What the camera senders target together: they come off the top of the budget. */
  #cameraTargets(): number {
    let total = 0;
    for (const { slot, state } of this.#videoSenders()) {
      if (!SLOTS[slot].shared) total += stepOf(state).maxBitrate;
    }
    return total;
  }

  /**
   * Each viewer's ceiling for the screen, by link: the lower of its fair share of the budget,
   * after the cameras, and what its own link carries (`pairCeilings`). A pair whose link holds
   * it down (`limited`) is taken to carry what its screen targets now, and the rest of its share
   * goes to the others. `probing` is taken to have no link limit: its probe is the test; a new
   * or resumed sender is asked about in the same way.
   */
  #viewerCeilings(probing?: Link): Map<Link, number> {
    const viewers = this.#viewers();
    const ceilings = pairCeilings(
      this.#budget.limit - this.#cameraTargets(),
      viewers.map((link) => ({
        link:
          link.quality.screen?.limited && link !== probing ? this.#screenTarget(link) : undefined,
      })),
    );
    return new Map(viewers.map((link, i) => [link, ceilings[i] as number]));
  }

  /**
   * The most a new or resumed `slot` sender to `link`'s peer may target: the room the budget has
   * left and, for a screen, no more than its pair's ceiling.
   */
  #allowance(link: Link, slot: VideoSlot): number {
    const state = link.quality[slot];
    const own = state && link.own.get(slot)?.sender.track ? stepOf(state).maxBitrate : 0;
    const room = this.#budget.room(this.#committed() - own);
    return SLOTS[slot].shared ? Math.min(room, this.#viewerCeilings(link).get(link) ?? room) : room;
  }

  /** What `link`'s other video sender is sending, which `slot`'s can't have of the estimate. */
  #reservedFor(link: Link, slot: VideoSlot): number {
    const other = VIDEO_SLOTS.find((s) => s !== slot) as VideoSlot;
    return link.own.get(other)?.sender.track ? (link.quality[other]?.last?.sendBitrate ?? 0) : 0;
  }

  /**
   * Every video sender being sent (one with a track and a place on its ladder). A failed pair's
   * senders keep their tracks until a retry, but nothing flows over them, so they are not in the
   * budget: its total must agree with `#viewers`, which leaves a failed pair out, or the fair
   * shares would add up to the whole budget while the senders' targets add up to more, and an
   * entitled probe would overshoot it and be shed again in the same pass, for ever.
   */
  *#videoSenders(): Generator<VideoSender> {
    for (const link of this.#links.values()) {
      if (link.state === "failed") continue;
      for (const slot of VIDEO_SLOTS) {
        const state = link.quality[slot];
        const sender = link.own.get(slot)?.sender;
        if (state && sender?.track) yield { link, slot, state, sender };
      }
    }
  }

  /** What every video sender being sent targets together (each one's rung `maxBitrate`). */
  #committed(): number {
    let total = 0;
    for (const { state } of this.#videoSenders()) total += stepOf(state).maxBitrate;
    return total;
  }

  /**
   * How patient the controller is with `slot`'s `state` now: faster in a screen's first minute.
   * A camera keeps the normal pace.
   */
  #pace(slot: VideoSlot, state: Adaptation): Pace {
    return slot === "screen"
      ? paceOf(Date.now() - state.startedAt, this.#firstMinuteMs)
      : paceOf(Number.POSITIVE_INFINITY);
  }

  /** The pair's connection is up, so its senders are read (and can probe). */
  #live(link: Link): boolean {
    return link.state === "connected" || link.state === "relayed";
  }

  /**
   * Whether `state` may grow the budget now: no other sender of `slot` that can probe (a live
   * pair, clean for a window, below its top step) sits on a lower rung. A viewer on a
   * mediocre link, or a pair that isn't connected, never probes and so never holds the turn.
   */
  #hasTurn(slot: VideoSlot, state: Adaptation): boolean {
    for (const other of this.#videoSenders()) {
      if (other.slot !== slot || other.state === state || !this.#live(other.link)) continue;
      const track = other.sender.track as MediaStreamTrack;
      const canProbe = other.state.rung < SLOTS[slot].cap(track, other.state.steps);
      if (
        canProbe &&
        probeDue(
          other.state.window,
          other.state.backoff,
          this.#pace(slot, other.state).upSamples,
        ) &&
        other.state.rung < state.rung
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Whether `state` may step up to `rung` (it proposes a probe). A screen within its pair's
   * ceiling is entitled to it, and if pairs above theirs have used the room up they are the ones
   * to step down (`#fitBudget`). Otherwise it has to fit the room the budget has left, counting
   * every other viewer of the screen at no less than its ceiling, or else it goes on its turn
   * after a clean spell, which grows the budget to fit it (`probeClaim`).
   */
  #admit(link: Link, slot: VideoSlot, state: Adaptation, rung: number): boolean {
    const next = stepAt(state, rung).maxBitrate;
    const ceilings = this.#viewerCeilings(link);
    const claims: Claim[] = [...ceilings].map(([viewer, ceiling]) => ({
      camera: false,
      target: this.#screenTarget(viewer),
      ceiling,
    }));
    const self = SLOTS[slot].shared ? [...ceilings.keys()].indexOf(link) : -1;
    for (const sender of this.#videoSenders()) {
      if (!SLOTS[sender.slot].shared) {
        claims.push({ camera: true, target: stepOf(sender.state).maxBitrate });
      }
    }
    const { within, committed } = probeClaim(claims, self, next);
    return (
      within ||
      this.#budget.admit(committed, next - stepOf(state).maxBitrate, this.#hasTurn(slot, state))
    );
  }

  /**
   * Step senders down, a rung at a time, until their targets fit the budget: a camera before
   * any screen, then the screen furthest above its pair's ceiling (`shedFirst`). A pair whose
   * pass is still running (a stats read that hasn't returned) is left alone.
   */
  #fitBudget(): void {
    while (this.#committed() > this.#budget.limit) {
      const ceilings = this.#viewerCeilings();
      const senders = [...this.#videoSenders()].filter(
        (sender) => sender.state.rung > 0 && !sender.link.adjusting,
      );
      const first = shedFirst(
        senders.map(({ link, slot, state }) => {
          const bitrate = stepOf(state).maxBitrate;
          const shared = SLOTS[slot].shared;
          return {
            camera: !shared,
            bitrate,
            over: shared ? aboveCeiling(bitrate, ceilings.get(link)) : 0,
          };
        }),
      );
      if (first === undefined) return;
      const { link, slot, state, sender } = senders[first] as VideoSender;
      this.#rungChanged(link, slot, stepOf(state), stepAt(state, state.rung - 1), "budget");
      restart(state, state.rung - 1);
      this.#tune(link, slot, sender);
    }
  }

  #watchQuality(): void {
    this.#adjustTimer ??= setInterval(() => void this.adjust(), QUALITY_INTERVAL_MS);
  }

  async #adjustLink(link: Link): Promise<PairReading | undefined> {
    if (link.adjusting) return undefined;
    if (!this.#live(link)) {
      // A window across a reconnect would average the outage in.
      this.#telemetry?.dropWindows(link.userId);
      return undefined;
    }
    link.adjusting = true;
    try {
      const reading = await this.#adjustSenders(link);
      await this.#readReceivers(link);
      // After the pass's own work, and not waited for: a slow or hung read of the connection's
      // stats must never hold up the adjustment (ADR 2: the pass costs what its sender reads do).
      this.#checkPath(link);
      return reading;
    } finally {
      link.adjusting = false;
    }
  }

  /**
   * The row for `slot` to `link`'s peer moving from rung `from` to `to` (telemetry), and, for a
   * screen, what made the move for the quality modal: `pressure` is the cause recorded from the
   * samples that moved it (`pressureCause`), the other reasons are their own.
   */
  #rungChanged(
    link: Link,
    slot: VideoSlot,
    from: Rung,
    to: Rung,
    reason: RungReason,
    pressure?: PressureCause,
  ): void {
    if (from.label === to.label) return;
    if (slot === "screen") link.stepCause = causeOf(reason, pressure);
    this.#telemetry?.rungChanged(
      { peerId: link.userId, slot, direction: "send" },
      rungInfo(to),
      reason,
    );
  }

  /**
   * Tell telemetry which of `userId`'s streams are in progress towards this page: the screen
   * while they share it, the camera while it is on and this page shows it (a hidden camera is
   * paused towards this page, which would read as a stall).
   */
  #reportSharing(userId: string): void {
    const media = this.#media.get(userId);
    if (!media) return;
    // Their share ended: what was heard and measured of it ends with it (the quality modal).
    if (!media.share) this.#forgetReceived(userId);
    this.#telemetry?.setSharing(userId, "screen", media.share);
    const camShown = this.#shown.get(userId)?.get("cam") !== false;
    this.#telemetry?.setSharing(userId, "cam", media.cam && camShown);
  }

  /**
   * Take telemetry readings of the video `link`'s peer sends this page, and the quality modal's
   * of their screen.
   */
  async #readReceivers(link: Link): Promise<void> {
    for (const slot of VIDEO_SLOTS) {
      const screenShared = slot === "screen" && this.#sharing(link.userId);
      // Without telemetry only a screen that is being shared is of interest (the modal's).
      if (!this.#telemetry && !screenShared) continue;
      const reading = await this.#readReceiver(link, slot);
      if (!reading) continue;
      this.#telemetry?.observe({ peerId: link.userId, slot, direction: "recv" }, reading);
      if (screenShared) this.#viewReceived(link, reading);
    }
  }

  /**
   * The reading of the `slot` video `link`'s peer sends this page; undefined if there is none
   * yet, the read failed (logged), or the track or connection changed while it ran.
   */
  async #readReceiver(link: Link, slot: VideoSlot): Promise<StreamReading | undefined> {
    const track = link.tracks[slot];
    const receiver = track && link.pc.getReceivers().find((r) => r.track === track);
    if (!receiver) return undefined;
    try {
      const reading = readStream(await receiver.getStats(), "recv");
      return this.#current(link) && link.tracks[slot] === track ? reading : undefined;
    } catch (error) {
      this.#log(`reading ${slot} stats from ${link.userId} failed`, error);
      return undefined;
    }
  }

  /**
   * `parse` of `sender`'s stats; undefined if the read failed (logged), or what the sender sends
   * or its ladder `state` changed while it ran, so the reading is of something else.
   */
  async #readSender<T>(
    link: Link,
    slot: VideoSlot,
    sender: RTCRtpSender,
    state: Adaptation,
    parse: (report: RTCStatsReport) => T,
  ): Promise<T | undefined> {
    const track = sender.track;
    try {
      const parsed = parse(await sender.getStats());
      const same = this.#current(link) && sender.track === track && link.quality[slot] === state;
      return same ? parsed : undefined;
    } catch (error) {
      this.#log(`reading ${slot} stats for ${link.userId} failed`, error);
      return undefined;
    }
  }

  async #adjustSenders(link: Link): Promise<PairReading> {
    const reading: PairReading = {};
    for (const slot of VIDEO_SLOTS) {
      const sender = link.own.get(slot)?.sender;
      const track = sender?.track;
      if (!sender || !track) continue;
      const state = this.#adaptation(link, slot, track);
      const read = await this.#readSender(link, slot, sender, state, (report) => ({
        sample: readSample(report, state.last),
        stream: readStream(report, "send"),
      }));
      if (!read) continue;
      const { sample, stream } = read;
      // The codec first: its cap is the one this reading, and the step after it, are judged by.
      if (sample.codec) state.codec = sample.codec;
      if (stream) {
        this.#telemetry?.observe(
          { peerId: link.userId, slot, direction: "send" },
          stream,
          rungInfo(stepOf(state)),
        );
        if (slot === "screen") this.#viewSent(link, state, stream);
      }
      state.last = sample;
      const pace = this.#pace(slot, state);
      if (state.readings++ >= pace.warmup) {
        reading.strained = (reading.strained ?? false) || strained(sample);
        const max = SLOTS[slot].cap(track, state.steps);
        const options = { max, reserved: this.#reservedFor(link, slot), upSamples: pace.upSamples };
        const ladder = ladderOf(state);
        let next = step(ladder, state, sample, options);
        // A probe the budget refuses is no probe: the window carries on as it was.
        if (next.rung > state.rung && !this.#admit(link, slot, state, next.rung)) {
          next = step(ladder, state, sample, { ...options, max: state.rung });
        }
        // Down to the capture's cap when the capture shrank; otherwise the controller's call.
        const reason: RungReason =
          next.rung > state.rung ? "probe" : state.rung > max ? "capture" : "pressure";
        // What a step down under pressure was down to (the samples that moved it), for the modal:
        // on that change, and to say why the pair is held there while it is.
        const pressure =
          next.rung < state.rung && reason === "pressure"
            ? pressureCause(...[...state.window, sample].slice(-DOWN_SAMPLES))
            : undefined;
        this.#rungChanged(link, slot, stepOf(state), ladder[next.rung] as Rung, reason, pressure);
        const held = next.rung < state.rung && reason === "pressure" ? pressure : state.cause;
        Object.assign(state, next, { cause: next.limited ? held : undefined });
      }
      this.#tune(link, slot, sender);
    }
    return reading;
  }

  // -------------------------------------------------------------------------------------------
  // The quality modal (ADR 2 addendum): what this page keeps and tells about screen shares.

  /** Whether the server says `userId` shares their screen (everything counts as shared until said). */
  #sharing(userId: string): boolean {
    return this.#media.get(userId)?.share !== false;
  }

  /** `userId`'s share is over (or they are gone): what was heard and measured of it goes. */
  #forgetReceived(userId: string): void {
    this.#history.forget(streamKey("recv", userId));
    this.#notes.delete(userId);
  }

  /** This page's own share ended or began anew: every viewer hears about it afresh. */
  #endShare(): void {
    for (const link of this.#links.values()) {
      link.notes.reset();
      link.stepNoted = undefined;
      link.stepCause = undefined;
      this.#history.forget(streamKey("send", link.userId));
    }
    this.#history.forget(UPLINK);
  }

  /** Take in what the streamer `from` told this page; a step change is noted for the timeline. */
  #hear(from: string, note: StepNote): void {
    const was = this.#notes.get(from);
    const now = applyNote(was, note);
    if (now === was) return;
    this.#notes.set(from, now);
    if (now.step === was?.step) return;
    // The first message heard isn't a change this page saw, so it has no cause to give.
    this.#history.changed(
      streamKey("recv", from),
      stepChange(was?.step, now.step, was ? now.cause : undefined),
    );
  }

  /** A reading of the screen `link`'s peer sends this page, with the cap they last told of. */
  #viewReceived(link: Link, reading: StreamReading): void {
    this.#history.observe(
      streamKey("recv", link.userId),
      reading,
      this.#notes.get(link.userId)?.maxBitrate,
    );
  }

  /** A reading of the screen sender to `link`'s peer, with the cap of the step it is on. */
  #viewSent(link: Link, state: Adaptation, reading: StreamReading): void {
    this.#history.observe(streamKey("send", link.userId), reading, stepOf(state).maxBitrate);
  }

  /** Read the screen `link`'s peer sends this page now, for the modal. */
  async #refreshReceived(link: Link): Promise<void> {
    if (!this.#live(link) || !this.#sharing(link.userId)) return;
    const reading = await this.#readReceiver(link, "screen");
    if (reading) this.#viewReceived(link, reading);
  }

  /** Read the screen this page sends `link`'s peer now, for the modal. */
  async #refreshSent(link: Link): Promise<void> {
    const sender = link.own.get("screen")?.sender;
    const state = link.quality.screen;
    if (!sender?.track || !state || !this.#live(link)) return;
    const reading = await this.#readSender(link, "screen", sender, state, (report) =>
      readStream(report, "send"),
    );
    if (reading) this.#viewSent(link, state, reading);
  }

  /**
   * Everything this page sends against the uplink budget: each viewer's screen as last read, and
   * the cameras as the quality pass last read them (the modal doesn't read those a second).
   */
  #recordUplink(): void {
    if (!this.#local.screen) return;
    let bps = 0;
    const now = Date.now();
    for (const { link, slot, state } of this.#videoSenders()) {
      if (!this.#live(link)) continue;
      if (slot !== "screen") {
        bps += state.last?.sendBitrate ?? 0;
        continue;
      }
      // A viewer not read for a couple of passes (its read hangs, it stopped) sends nothing we know of.
      const newest = this.#history.points(streamKey("send", link.userId)).at(-1);
      if (newest && now - newest.at <= STALE_READING_MS) bps += newest.bps ?? 0;
    }
    this.#history.record(UPLINK, { bps, capBps: this.#budget.limit });
  }

  /**
   * What `link`'s screen sender is on, and why: its step, that step's cost, and the reason
   * (`reasonOf`) from the controller's state. Undefined while it has no sender or step.
   */
  #stepBody(link: Link, ceilings: Map<Link, number>): StepBody | undefined {
    const state = link.quality.screen;
    const track = link.own.get("screen")?.sender.track;
    if (!state || !track) return undefined;
    const step = stepOf(state);
    return {
      step: step.label,
      maxBitrate: step.maxBitrate,
      ...(link.stepCause && { cause: link.stepCause }),
      reason: reasonOf({
        atTop: state.rung >= SLOTS.screen.cap(track, state.steps),
        probing: state.probing,
        limited: state.limited,
        cause: state.cause,
        pressure: state.last && pressureCause(state.last),
        nextBitrate: ladderOf(state)[state.rung + 1]?.maxBitrate,
        ceiling: ceilings.get(link),
      }),
    };
  }

  /**
   * Note `link`'s step in this page's own timeline when it changed, and tell the peer what it is
   * on and why when that changed (or the pair connected again). `NoteSender` decides whether it
   * is due; a send the socket dropped stays due. Called wherever the step or what decides its
   * reason may have moved: after a quality pass, a connect, a resume, a reconnected socket.
   */
  #tell(link: Link, ceilings = this.#viewerCeilings()): void {
    if (!this.#current(link) || !this.#local.screen || !this.#live(link)) return;
    const body = this.#stepBody(link, ceilings);
    if (!body) return;
    if (link.stepNoted !== body.step) {
      // The first step noted isn't a change from anything, so it has no cause to give.
      const cause = link.stepNoted ? body.cause : undefined;
      this.#history.changed(
        streamKey("send", link.userId),
        stepChange(link.stepNoted, body.step, cause),
      );
      link.stepNoted = body.step;
    }
    const now = Date.now();
    const note = link.notes.due(body, now);
    if (note && this.#signal(link, { kind: "quality", ...note })) link.notes.delivered(note, now);
  }

  /** The quality modal's view of this page's own share (see `streamQuality`). */
  #localQuality(): StreamerQuality | undefined {
    if (!this.#local.screen) return undefined;
    const ceilings = this.#viewerCeilings();
    const links = [...this.#links.values()].filter((link) => !link.paused.has("screen"));
    const changes = links.flatMap((link) =>
      this.#history
        .changes(streamKey("send", link.userId))
        .map((change) => ({ ...change, userId: link.userId })),
    );
    return {
      side: "streamer",
      budget: this.#budget.limit,
      budgetMeasured: this.#budget.measured,
      uplink: this.#history.points(UPLINK),
      viewers: links.map((link) => {
        const key = streamKey("send", link.userId);
        const note = this.#stepBody(link, ceilings);
        const path = pathLabel(this.#history.latest(key));
        return {
          userId: link.userId,
          state: link.state,
          ...(note && { note }),
          ...(path && { path }),
          points: this.#history.points(key),
        };
      }),
      changes: changes.sort((a, b) => a.at - b.at),
    };
  }

  #shut(link: Link): void {
    this.#stopWaiting(link);
    const pc = link.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
  }

  #current(link: Link): boolean {
    return !this.#closed && this.#links.get(link.userId) === link;
  }

  async #offer(link: Link): Promise<void> {
    try {
      link.makingOffer = true;
      await link.pc.setLocalDescription();
      if (this.#current(link)) this.#sendDescription(link);
    } catch (error) {
      if (this.#current(link)) this.#log(`offering to ${link.userId} failed`, error);
      this.#negotiationFailed(link, "offer", error);
    } finally {
      link.makingOffer = false;
    }
  }

  async #handle(
    link: Link,
    payload: Exclude<SignalPayload, { kind: "hello" | "visibility" | "quality" }>,
  ): Promise<void> {
    if (!this.#current(link)) return;
    const pc = link.pc;
    if (payload.kind === "candidate") {
      if (!payload.candidate) return;
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (error) {
        // Candidates for an offer this side ignored fail, as they should.
        if (!link.ignoreOffer) {
          // Once until a description is applied: a refused description is followed by every
          // candidate trickled after it, and each would be the same news.
          if (!link.candidateFailed) {
            link.candidateFailed = true;
            this.#negotiationFailed(link, "candidate", error);
          }
          throw error;
        }
      }
      return;
    }
    const description = payload.description;
    const offer = description.type === "offer";
    // An offer sent again after a `hello` that crossed it (with more candidates, if it waited).
    if (offer && isSameOffer(description.sdp, link.remoteSdp)) return;
    for (const [mid, slot] of Object.entries(payload.slots ?? {})) link.remoteSlots.set(mid, slot);
    const collision = offer && (link.makingOffer || pc.signalingState !== "stable");
    link.ignoreOffer = !link.polite && collision;
    if (link.ignoreOffer) return;
    const sdp = this.#forSenders(link, description.sdp);
    // A polite side's own pending offer is rolled back implicitly.
    try {
      await pc.setRemoteDescription({ type: description.type, sdp });
    } catch (error) {
      this.#negotiationFailed(link, "remote_description", error);
      throw error;
    }
    link.remoteSdp = description.sdp;
    link.candidateFailed = false;
    // Encoding parameters can only be set once there is something negotiated to set them on.
    for (const slot of VIDEO_SLOTS) {
      const sender = link.own.get(slot)?.sender;
      if (sender) this.#tune(link, slot, sender);
    }
    if (offer) {
      try {
        await pc.setLocalDescription();
      } catch (error) {
        this.#negotiationFailed(link, "answer", error);
        throw error;
      }
      if (!this.#current(link)) return;
      this.#sendDescription(link);
      // The polite side's own transceivers: negotiated next, from a stable state.
      this.#start(link);
    }
  }

  /**
   * `sdp`, a description this side applies, with what its senders should encode for the other
   * side's sake (a sender is configured from the remote description): stereo Opus for share
   * audio, and the bandwidth estimate the screen starts at (`seedBitrate`, from the step the pair
   * starts on and its ceiling). The camera is left as it is. It only reads: no ladder state is
   * made or changed here, so applying a description has no side effects of its own.
   *
   * The seed goes only into the first remote description a connection applies, which is what
   * starts its estimate. Measured in Chromium 153 (ADR 2 addendum): there the estimate starts at
   * the seed and holds. In any later description (a share added to a live pair, or the polite
   * side's own offer, which follows its answer as ICE connects) it resets an estimate that is
   * running, which then often collapses to a few hundred kbps and takes tens of seconds to recover,
   * where without a seed it reaches the bitrate in under a second. So a pair is seeded once, and
   * only if the screen is in the negotiation that sets it up (the side that offers first, with
   * the share already on when the viewer arrives), and the value is never changed.
   */
  #forSenders(link: Link, sdp: string | undefined): string | undefined {
    if (!sdp) return sdp;
    const shareAudio = link.own.get("screenAudio")?.mid;
    const stereo = shareAudio ? withStereoOpus(sdp, new Set([shareAudio])) : sdp;
    const screen = link.own.get("screen");
    const track = screen?.sender.track;
    if (link.pc.remoteDescription || !screen?.mid || !track) return stereo;
    // The step this pair starts on (the one it is on, if it has begun), and no more than its
    // ceiling. Nothing is created or changed here: the ladder state is made when the sender is tuned.
    // The cap is the one of the codec the sender will send: from its stats if it has sent, else
    // the first codec the description being applied lists for it. A pair that has sent nothing
    // yet starts on the step that codec's caps allow (`#adaptation` does the same once tuned).
    const state = link.quality.screen;
    const codec = state?.codec ?? sentCodecOf(sdp, new Set([screen.mid]));
    const { steps } = SLOTS.screen.steps(track, state?.sixty);
    const start =
      state && state.readings > 0
        ? (state.steps[state.rung] as Rung)
        : (steps[this.#startRung(link, "screen", track, steps, codec)] as Rung);
    const seed = seedBitrate(codecCap(start, codec), this.#viewerCeilings(link).get(link));
    return withStartBitrate(stereo, new Set([screen.mid]), seed);
  }

  /** Send `link`'s local description; if `send` drops it, it waits for `resend`. */
  #sendDescription(link: Link): void {
    const step = this.#describe(link);
    if (!step) return;
    if (step.description.type === "answer") link.answerUnsent = step;
    else link.offerUnsent = true;
    this.#flush(link);
  }

  /** `link`'s local description as a step, with what its transceivers carry. */
  #describe(link: Link): DescriptionStep | undefined {
    const description = link.pc.localDescription;
    if (!description) return undefined;
    const slots: Record<string, MediaSlot> = {};
    for (const [slot, transceiver] of link.own) if (transceiver.mid) slots[transceiver.mid] = slot;
    return {
      kind: "description",
      description: { type: description.type, sdp: description.sdp },
      slots,
      ...this.#decodable(),
    };
  }

  /**
   * Send what `send` dropped, an answer before the offer that came after it, and stop at the
   * first drop. A waiting answer or offer goes as it stands now, with the candidates gathered
   * since (those were dropped too).
   */
  #flush(link: Link): void {
    if (link.answerUnsent) {
      // The answer is the connection's current local description, even once an offer follows it.
      const local = link.pc.currentLocalDescription ?? link.pc.localDescription;
      const kept = link.answerUnsent;
      const answer: DescriptionStep =
        local?.type === "answer" && isSameOffer(local.sdp, kept.description.sdp)
          ? { ...kept, description: { type: local.type, sdp: local.sdp } }
          : kept;
      if (!this.#signal(link, answer)) return;
      link.answerUnsent = undefined;
    }
    if (!link.offerUnsent) return;
    const offer = link.pc.signalingState === "have-local-offer" ? this.#describe(link) : undefined;
    if (!offer || this.#signal(link, offer)) link.offerUnsent = false;
  }

  /** The video codecs this side tells peers it can decode. */
  #decodable(): { codecs?: string[] } {
    return this.#codecs ? { codecs: this.#codecs.receive } : {};
  }

  /** Whether `step` went out (not if `send` dropped it, or the connection is gone). */
  #signal(link: Link, step: Step): boolean {
    if (!this.#current(link)) return false;
    return this.#send(link.userId, {
      ...step,
      session: link.session,
      ...(link.remoteSession ? { peerSession: link.remoteSession } : {}),
    } as SignalPayload);
  }

  #track(link: Link, transceiver: RTCRtpTransceiver, track: MediaStreamTrack): void {
    if (!this.#current(link)) return;
    const slot = transceiver.mid ? link.remoteSlots.get(transceiver.mid) : undefined;
    if (!slot) return;
    link.tracks[slot] = track;
    this.#emit({ type: "track", userId: link.userId, slot, track });
  }

  #stateChanged(link: Link): void {
    if (!this.#current(link)) return;
    this.#reportState(link, link.pc.connectionState);
    switch (link.pc.connectionState) {
      case "connected":
        this.#stopWaiting(link);
        link.restarted = false;
        void this.#connected(link);
        return;
      case "failed":
        this.#failed(link, "failed");
        return;
      case "closed":
        // `closed` events cover it.
        return;
      default:
        // new, connecting, and disconnected (which usually recovers by itself).
        this.#waitToConnect(link);
        this.#setState(link, "connecting");
    }
  }

  /** Connected: directly, or through a TURN relay, going by the selected candidate pair. */
  async #connected(link: Link): Promise<void> {
    const ice = await this.#icePath(link);
    if (!this.#current(link) || link.pc.connectionState !== "connected") return;
    this.#setState(link, ice && isRelayed(ice) ? "relayed" : "connected", ice);
    this.#reportPath(link, ice, "connect");
    this.#ended(link, true);
  }

  /** Arm the connect timeout, unless it is already running. */
  #waitToConnect(link: Link): void {
    if (link.connectTimer !== undefined) return;
    link.connectTimer = setTimeout(() => {
      this.#stopWaiting(link);
      if (this.#current(link) && link.pc.connectionState !== "connected") {
        this.#failed(link, "timeout");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  #stopWaiting(link: Link): void {
    clearTimeout(link.connectTimer);
    link.connectTimer = undefined;
  }

  /**
   * It failed, or took too long: one automatic attempt, then `failed` until it connects after
   * all or `retry` starts it over. A negotiated pair gets an ICE restart (both sides gather anew,
   * with the latest ICE servers), and its failure comes with its ICE path. A pair that never
   * negotiated (the offer or answer went missing) has no ICE to restart, so it starts over
   * (a new session, and a `hello`); its failure is a signalling stall, not an ICE failure, and
   * comes without an ICE path.
   */
  #failed(link: Link, why: RestartReason): void {
    this.#stopWaiting(link);
    const negotiated = link.pc.remoteDescription !== null;
    if (!negotiated) this.#negotiationFailed(link, "never_finished");
    if (!negotiated && !link.startedOver) {
      this.#startOver(link.userId, why, true);
      return;
    }
    if (negotiated && !link.restarted) {
      this.#restartIce(link, why);
      return;
    }
    if (link.state === "failed") return;
    // Giving up: a timeout is not a state the connection reported itself.
    this.#reportState(link, "failed");
    this.#ended(link, false);
    if (!negotiated) {
      this.#setState(link, "failed");
      return;
    }
    link.state = "failed";
    void this.#icePath(link).then((ice) => {
      if (this.#current(link) && link.state === "failed") {
        this.#emit({ type: "state", userId: link.userId, state: "failed", ...(ice && { ice }) });
      }
    });
  }

  /** Restart ICE on `link` with the latest ICE servers (its one automatic restart). */
  #restartIce(link: Link, why: RestartReason): void {
    link.restarted = true;
    this.#began(link, "ice_restart", why);
    this.#configure(link);
    link.pc.restartIce();
    this.#waitToConnect(link);
    this.#setState(link, "connecting");
  }

  /** The connection's anonymised ICE path, from its stats (undefined if they can't be read). */
  async #icePath(link: Link): Promise<IcePath | undefined> {
    try {
      return icePathOf(await link.pc.getStats());
    } catch (error) {
      this.#log(`reading ICE stats for ${link.userId} failed`, error);
      return undefined;
    }
  }

  /** Replace the connection to `userId` with a new one; the peer starts over too. */
  #startOver(userId: string, why: RestartReason, automatic = false): void {
    this.peerLeft(userId);
    this.#began(this.#open(userId, true, automatic), "start_over", why);
  }

  // The room timeline's reports (ADR 3 addendum). A pair is reported to `onReport` as it goes.

  #report(event: ConnectionEvent | undefined): void {
    if (!event || this.#closed) return;
    try {
      this.#onReport?.(event);
    } catch {
      // Reporting is best-effort: a listener that throws must never break a connection.
    }
  }

  /** A restart or start-over of `link` began; the next time it connects, or gives up, is its end. */
  #began(link: Link, how: RestartKind, why: RestartReason): void {
    link.attempt = { how, since: Date.now() };
    this.#report(restartEvent(link.userId, how, why));
  }

  /** The restart in progress on `link` ended: the pair connected again, or gave up. */
  #ended(link: Link, recovered: boolean): void {
    const { attempt } = link;
    if (!attempt) return;
    link.attempt = undefined;
    this.#report(recoveryEvent(link.userId, attempt.how, recovered, Date.now() - attempt.since));
  }

  /** The connection state of `link`'s pair, unless it is the one just reported. */
  #reportState(link: Link, state: string): void {
    if (link.stateReported === state) return;
    link.stateReported = state;
    this.#report(pairStateEvent(link.userId, state));
  }

  /** The path `link` uses now: reported when the pair connects (`connect`), or if it moved. */
  #reportPath(link: Link, ice: IcePath | undefined, change: "connect" | "change"): void {
    if (!this.#onReport) return;
    const event = pathEvent(link.userId, ice ?? { local: [], remote: [] }, change);
    const key = pathKey(event);
    // A path that can't be read now says nothing about a change.
    if (change === "change" && (event.kind !== "pair_path" || event.path === "unknown")) return;
    if (change === "change" && key === link.pathKey) return;
    link.pathKey = key;
    this.#report(event);
  }

  /** Report a failed negotiation step with `link`'s peer (`error` absent: it never finished). */
  #negotiationFailed(link: Link, step: NegotiationStep, error?: unknown): void {
    if (this.#current(link)) this.#report(negotiationEvent(link.userId, step, error));
  }

  /**
   * On a quality pass, see whether a connected pair has moved to another path, and report it.
   * Runs on its own (the pass doesn't wait for it), one read per pair at a time: a read that
   * hangs holds its pair's next checks off, and nothing else.
   */
  #checkPath(link: Link): void {
    if (!this.#onReport || link.pathKey === undefined || link.pathReading) return;
    link.pathReading = true;
    void this.#icePath(link)
      .then((ice) => {
        if (ice && this.#live(link)) this.#reportPath(link, ice, "change");
      })
      .finally(() => {
        link.pathReading = false;
      });
  }

  /** Give `link` the current ICE servers (used from its next ICE restart). */
  #configure(link: Link): void {
    try {
      link.pc.setConfiguration({ ...link.pc.getConfiguration(), iceServers: this.#iceServers });
    } catch (error) {
      this.#log(`updating ICE servers for ${link.userId} failed`, error);
    }
  }

  #setState(link: Link, state: PeerState, ice?: IcePath): void {
    if (state === link.state) return;
    link.state = state;
    this.#emit({ type: "state", userId: link.userId, state, ...(ice && { ice }) });
    // Everything counts as shown on their side until told, and a step sent while the pair was
    // down may have been dropped (their reconnect grace): all of it again.
    if (state === "connected") {
      for (const [slot, visible] of this.#shown.get(link.userId) ?? []) {
        this.#signal(link, { kind: "visibility", slot, visible });
      }
    }
    // The same goes for the step this side's screen is on: the peer is told it again.
    if (state === "connected" || state === "relayed") {
      link.notes.reset();
      this.#tell(link);
    }
  }

  #emit(event: MeshEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
