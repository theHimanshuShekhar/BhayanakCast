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
 * A connection that fails, or doesn't connect within `CONNECT_TIMEOUT_MS`, gets one ICE restart
 * (with the latest ICE servers: STUN plus TURN, ADR 3), or one start-over if it never even
 * negotiated; if that fails too it is `failed` until `retry` starts it over. Once connected, its
 * selected candidate pair says whether it is `relayed` through TURN. `relayed`, and `failed`
 * after ICE was tried, come with the connection's anonymised ICE path.
 *
 * A camera this page isn't showing (a hidden or scrolled-away tile) is paused towards it, to save
 * the sender's upload (ADR 2 addendum): `setVisible` tells that peer with a `visibility` step
 * (over signalling, which needs no ICE; the whole state again whenever the pair connects, in
 * case a step was lost), and the sender swaps in no track for this page alone until shown.
 *
 * A screen share is tuned as its track says (ADR 2 addendum): the sender's degradation
 * preference follows the screen track's `contentHint`, and share audio goes as stereo Opus at
 * `SHARE_AUDIO_BITRATE` (asked for in the Opus parameters of the remote descriptions this side
 * applies, which is where browsers take them from).
 *
 * Local tracks belong to the caller (./local-media.ts): the Mesh never stops them.
 */
import { type IcePath, icePathOf, isRelayed, STUN_SERVERS } from "./ice";
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

/** How long a connection may take to connect (or reconnect) before it gets an ICE restart. */
export const CONNECT_TIMEOUT_MS = 20_000;

export interface MeshOptions {
  /** This user's id: decides who is polite in each pair. */
  selfId: string;
  /** Deliver `payload` to peer `to` (the `signal` message). */
  send: (to: string, payload: SignalPayload) => void;
  /** The ICE servers (see `setIceServers`). Defaults to `STUN_SERVERS`. */
  iceServers?: RTCIceServer[];
  /** Where negotiation failures are reported. Defaults to `console.warn`. */
  log?: (message: string, error?: unknown) => void;
  /** For tests. */
  RTCPeerConnection?: typeof RTCPeerConnection;
}

const SLOT_KIND: Record<MediaSlot, "audio" | "video"> = {
  mic: "audio",
  cam: "video",
  screen: "video",
  screenAudio: "audio",
};

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
 * `sdp` with stereo Opus at `SHARE_AUDIO_BITRATE` in the m-sections whose mid is in `mids`
 * (this side's share audio): a sender encodes what the other side's description asks for.
 */
export function withStereoOpus(sdp: string, mids: ReadonlySet<string>): string {
  if (mids.size === 0) return sdp;
  const [session = "", ...media] = sdp.split(/\r\n(?=m=)/);
  const sections = media.map((section) => {
    const lines = section.split("\r\n");
    const mid = lines.find((line) => line.startsWith("a=mid:"))?.slice("a=mid:".length);
    if (mid === undefined || !mids.has(mid)) return section;
    const opus = lines
      .map((line) => /^a=rtpmap:(\d+) opus\/48000/i.exec(line)?.[1])
      .find((pt) => pt !== undefined);
    if (opus === undefined) return section;
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
    return lines.join("\r\n");
  });
  return [session, ...sections].join("\r\n");
}

const newSession = () => Math.random().toString(36).slice(2, 12);

type Step =
  | Omit<Extract<SignalPayload, { kind: "description" }>, "session" | "peerSession">
  | Omit<Extract<SignalPayload, { kind: "candidate" }>, "session" | "peerSession">
  | Omit<Extract<SignalPayload, { kind: "visibility" }>, "session" | "peerSession">;

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
  /** Slots the peer isn't showing: sent to it as no track. */
  paused: Set<MediaSlot>;
  tracks: Partial<Record<MediaSlot, MediaStreamTrack>>;
  /** Incoming steps, handled one at a time. */
  queue: Promise<void>;
  /** It had its ICE restart since it last connected. */
  restarted: boolean;
  /** It replaces a connection that never negotiated (see `#failed`). */
  startedOver: boolean;
  /** Runs out while it is connecting (`CONNECT_TIMEOUT_MS`). */
  connectTimer?: ReturnType<typeof setTimeout>;
}

export class Mesh {
  readonly #selfId: string;
  readonly #send: MeshOptions["send"];
  #iceServers: RTCIceServer[];
  readonly #log: (message: string, error?: unknown) => void;
  readonly #RTCPeerConnection: typeof RTCPeerConnection;
  readonly #links = new Map<string, Link>();
  readonly #listeners = new Set<(event: MeshEvent) => void>();
  readonly #local: Partial<Record<MediaSlot, MediaStreamTrack | null>> = {};
  /** Per peer, whether this page shows each slot of theirs it has said (kept across reconnects). */
  readonly #shown = new Map<string, Map<MediaSlot, boolean>>();
  #closed = false;

  constructor(options: MeshOptions) {
    this.#selfId = options.selfId;
    this.#send = options.send;
    this.#iceServers = options.iceServers ?? STUN_SERVERS;
    this.#log = options.log ?? ((message, error) => console.warn(`[mesh] ${message}`, error));
    this.#RTCPeerConnection = options.RTCPeerConnection ?? RTCPeerConnection;
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
      if (!this.#links.has(participant.userId)) this.#open(participant.userId);
    }
    for (const userId of [...this.#links.keys()]) if (!present.has(userId)) this.peerLeft(userId);
  }

  /** Someone left the room (or was kicked): close their connection. */
  peerLeft(userId: string): void {
    const link = this.#links.get(userId);
    if (!link) return;
    this.#links.delete(userId);
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
    if (link?.remoteSession && link.remoteSession !== payload.session) {
      // They started over (a reload, a takeover): so does this side.
      this.peerLeft(from);
      link = undefined;
    }
    // The server only relays from people in the room, and ahead of their `left`. An offer is
    // the first word this side needs; anything else means theirs may have been lost.
    const offer = payload.kind === "description" && payload.description.type === "offer";
    link ??= this.#open(from, !offer);
    link.remoteSession = payload.session;
    if (payload.kind === "hello") {
      // They have no offer from this side: it went while they were away (their reconnect
      // grace), so send it again. It carries the candidates gathered so far.
      if (link.pc.signalingState === "have-local-offer") this.#sendDescription(link);
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
   * Use these ICE servers from now on (fresh TURN credentials): for new connections, and for
   * ICE restarts of the current ones.
   */
  setIceServers(iceServers: RTCIceServer[]): void {
    this.#iceServers = iceServers;
    for (const link of this.#links.values()) this.#configure(link);
  }

  /** Start over with `userId` (after `failed`): a new connection, and they start over too. */
  retry(userId: string): void {
    if (this.#closed || !this.#links.has(userId)) return;
    this.#startOver(userId);
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
      own: new Map(),
      remoteSlots: new Map(),
      paused: new Set(),
      tracks: {},
      queue: Promise.resolve(),
      restarted: false,
      startedOver,
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
    this.#waitToConnect(link);
    // The impolite side makes the first offer; the polite side starts once it has answered.
    if (!link.polite) this.#start(link);
    else if (greet) this.#send(userId, { kind: "hello", session: link.session });
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
    this.#tune(link, slot, transceiver.sender);
  }

  /** Swap what `slot`'s transceiver sends `link`'s peer (no renegotiation). */
  #sendSlot(link: Link, slot: MediaSlot, transceiver: RTCRtpTransceiver): void {
    transceiver.sender
      .replaceTrack(this.#outgoing(link, slot))
      .then(() => this.#tune(link, slot, transceiver.sender))
      .catch((error: unknown) => this.#log(`sending ${slot} to ${link.userId} failed`, error));
  }

  /** A screen sender's degradation preference follows its track's content hint (room kind). */
  #tune(link: Link, slot: MediaSlot, sender: RTCRtpSender): void {
    if (slot !== "screen" || !sender.track) return;
    const parameters = sender.getParameters();
    const degradationPreference = degradationFor(sender.track.contentHint);
    if (parameters.degradationPreference === degradationPreference) return;
    sender
      .setParameters({ ...parameters, degradationPreference })
      .catch((error: unknown) => this.#log(`tuning the share to ${link.userId} failed`, error));
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
    } finally {
      link.makingOffer = false;
    }
  }

  async #handle(
    link: Link,
    payload: Exclude<SignalPayload, { kind: "hello" | "visibility" }>,
  ): Promise<void> {
    if (!this.#current(link)) return;
    const pc = link.pc;
    if (payload.kind === "candidate") {
      if (!payload.candidate) return;
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (error) {
        // Candidates for an offer this side ignored fail, as they should.
        if (!link.ignoreOffer) throw error;
      }
      return;
    }
    const description = payload.description;
    const offer = description.type === "offer";
    // An offer sent again after a `hello` that crossed it (a new offer always differs).
    if (offer && description.sdp === link.remoteSdp) return;
    for (const [mid, slot] of Object.entries(payload.slots ?? {})) link.remoteSlots.set(mid, slot);
    const collision = offer && (link.makingOffer || pc.signalingState !== "stable");
    link.ignoreOffer = !link.polite && collision;
    if (link.ignoreOffer) return;
    const shareAudio = link.own.get("screenAudio")?.mid;
    const sdp =
      description.sdp && shareAudio
        ? withStereoOpus(description.sdp, new Set([shareAudio]))
        : description.sdp;
    // A polite side's own pending offer is rolled back implicitly.
    await pc.setRemoteDescription({ type: description.type, sdp });
    link.remoteSdp = description.sdp;
    if (offer) {
      await pc.setLocalDescription();
      if (!this.#current(link)) return;
      this.#sendDescription(link);
      // The polite side's own transceivers: negotiated next, from a stable state.
      this.#start(link);
    }
  }

  #sendDescription(link: Link): void {
    const description = link.pc.localDescription;
    if (!description) return;
    const slots: Record<string, MediaSlot> = {};
    for (const [slot, transceiver] of link.own) if (transceiver.mid) slots[transceiver.mid] = slot;
    this.#signal(link, {
      kind: "description",
      description: { type: description.type, sdp: description.sdp },
      slots,
    });
  }

  #signal(link: Link, step: Step): void {
    if (!this.#current(link)) return;
    this.#send(link.userId, {
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
    switch (link.pc.connectionState) {
      case "connected":
        this.#stopWaiting(link);
        link.restarted = false;
        void this.#connected(link);
        return;
      case "failed":
        this.#failed(link);
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
  }

  /** Arm the connect timeout, unless it is already running. */
  #waitToConnect(link: Link): void {
    if (link.connectTimer !== undefined) return;
    link.connectTimer = setTimeout(() => {
      this.#stopWaiting(link);
      if (this.#current(link) && link.pc.connectionState !== "connected") this.#failed(link);
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
  #failed(link: Link): void {
    this.#stopWaiting(link);
    const negotiated = link.pc.remoteDescription !== null;
    if (!negotiated && !link.startedOver) {
      this.#startOver(link.userId, true);
      return;
    }
    if (negotiated && !link.restarted) {
      link.restarted = true;
      this.#configure(link);
      link.pc.restartIce();
      this.#waitToConnect(link);
      this.#setState(link, "connecting");
      return;
    }
    if (link.state === "failed") return;
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
  #startOver(userId: string, automatic = false): void {
    this.peerLeft(userId);
    this.#open(userId, true, automatic);
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
  }

  #emit(event: MeshEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
