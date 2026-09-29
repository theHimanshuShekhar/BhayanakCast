/**
 * The Mesh (ADR 1 and its connection model): one `RTCPeerConnection` to every other person in
 * the room, written against the native WebRTC API. It hides negotiation from the room UI:
 *
 *   const mesh = new Mesh({ selfId, send: (to, payload) => socket.send({ type: "signal", to, payload }) });
 *   mesh.join(participants);                  // the room's people (a snapshot); again on any change
 *   mesh.receive(from, payload);              // each relayed `signal`
 *   mesh.setLocalTracks({ mic: track });      // what this page sends everyone (null: stop)
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
 * Local tracks belong to the caller (./local-media.ts): the Mesh never stops them.
 */
import type { MediaSlot, SignalPayload } from "./realtime";

/** `connecting` until media can flow, `connected`, or `failed` (#38 adds relayed/ICE restart). */
export type PeerState = "connecting" | "connected" | "failed";

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
  /** A peer's connection state changed (a new peer starts `connecting`). */
  | { type: "state"; userId: string; state: PeerState }
  /** A peer's track for `slot` arrived. */
  | { type: "track"; userId: string; slot: MediaSlot; track: MediaStreamTrack }
  /** A peer's connection closed (they left, or it restarted: a new `state` follows then). */
  | { type: "closed"; userId: string };

/** STUN only for now (ADR 3): #38 hands the Mesh STUN plus TURN from a server function. */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

export interface MeshOptions {
  /** This user's id: decides who is polite in each pair. */
  selfId: string;
  /** Deliver `payload` to peer `to` (the `signal` message). */
  send: (to: string, payload: SignalPayload) => void;
  /** The ICE servers for each new connection. Defaults to `STUN_SERVERS`. */
  iceServers?: () => RTCIceServer[];
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

const newSession = () => Math.random().toString(36).slice(2, 12);

type Step =
  | Omit<Extract<SignalPayload, { kind: "description" }>, "session" | "peerSession">
  | Omit<Extract<SignalPayload, { kind: "candidate" }>, "session" | "peerSession">;

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
  tracks: Partial<Record<MediaSlot, MediaStreamTrack>>;
  /** Incoming steps, handled one at a time. */
  queue: Promise<void>;
}

export class Mesh {
  readonly #selfId: string;
  readonly #send: MeshOptions["send"];
  readonly #iceServers: () => RTCIceServer[];
  readonly #log: (message: string, error?: unknown) => void;
  readonly #RTCPeerConnection: typeof RTCPeerConnection;
  readonly #links = new Map<string, Link>();
  readonly #listeners = new Set<(event: MeshEvent) => void>();
  readonly #local: Partial<Record<MediaSlot, MediaStreamTrack | null>> = {};
  #closed = false;

  constructor(options: MeshOptions) {
    this.#selfId = options.selfId;
    this.#send = options.send;
    this.#iceServers = options.iceServers ?? (() => STUN_SERVERS);
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
        if (transceiver) {
          transceiver.sender
            .replaceTrack(track)
            .catch((error: unknown) =>
              this.#log(`sending ${slot} to ${link.userId} failed`, error),
            );
        } else if (track) {
          this.#addSlot(link, slot, track);
        }
      }
    }
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

  /** Connect to `userId`; a polite side says `hello` unless `greet` is false (it has an offer). */
  #open(userId: string, greet = true): Link {
    const pc = new this.#RTCPeerConnection({ iceServers: this.#iceServers() });
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
      tracks: {},
      queue: Promise.resolve(),
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
    // The impolite side makes the first offer; the polite side starts once it has answered.
    if (!link.polite) this.#start(link);
    else if (greet) this.#send(userId, { kind: "hello", session: link.session });
    return link;
  }

  /** Start sending: the eager slots, and every local track there is. */
  #start(link: Link): void {
    if (link.started) return;
    link.started = true;
    for (const slot of EAGER_SLOTS) this.#addSlot(link, slot, this.#local[slot] ?? null);
    for (const [slot, track] of Object.entries(this.#local) as [MediaSlot, MediaStreamTrack][]) {
      if (track && !link.own.has(slot)) this.#addSlot(link, slot, track);
    }
  }

  /** Start sending `slot` to `link`'s peer over a transceiver of its own (renegotiates). */
  #addSlot(link: Link, slot: MediaSlot, track: MediaStreamTrack | null): void {
    const transceiver = link.pc.addTransceiver(track ?? SLOT_KIND[slot], { direction: "sendonly" });
    link.own.set(slot, transceiver);
  }

  #shut(link: Link): void {
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

  async #handle(link: Link, payload: Exclude<SignalPayload, { kind: "hello" }>): Promise<void> {
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
    // An offer sent again after a `hello` that crossed it (a new offer always differs).
    if (description.type === "offer" && description.sdp === pc.remoteDescription?.sdp) return;
    for (const [mid, slot] of Object.entries(payload.slots ?? {})) link.remoteSlots.set(mid, slot);
    const collision =
      description.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
    link.ignoreOffer = !link.polite && collision;
    if (link.ignoreOffer) return;
    // A polite side's own pending offer is rolled back implicitly.
    await pc.setRemoteDescription(description);
    if (description.type === "offer") {
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
    const state = peerState(link.pc.connectionState);
    if (!state || state === link.state) return;
    link.state = state;
    this.#emit({ type: "state", userId: link.userId, state });
  }

  #emit(event: MeshEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

/** The Mesh's view of a connection state (none for `closed`, which `closed` events cover). */
function peerState(state: RTCPeerConnectionState): PeerState | null {
  if (state === "connected") return "connected";
  if (state === "failed") return "failed";
  if (state === "closed") return null;
  // new, connecting, and disconnected (which usually recovers by itself).
  return "connecting";
}
