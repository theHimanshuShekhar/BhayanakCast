import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoCodecs } from "./codecs";
import {
  CONNECT_TIMEOUT_MS,
  degradationFor,
  isSameOffer,
  Mesh,
  type MeshEvent,
  QUALITY_INTERVAL_MS,
  SHARE_AUDIO_BITRATE,
  withStereoOpus,
} from "./mesh";
import {
  INITIAL_UPLINK,
  SCREEN_DEFAULT_RUNG,
  SCREEN_LADDER,
  UP_SAMPLES,
  UPLINK_DROP_LIMIT,
  UPLINK_FLOOR,
  UPLINK_SHARE,
} from "./quality";
import type { SignalPayload } from "./realtime";

// The Mesh's negotiation (#34) against a fake RTCPeerConnection that keeps the signalling state
// machine (offers, answers, implicit rollback, negotiationneeded) but carries no media; tests
// set its connection state and stats. Real browsers are covered by e2e/voice.spec.ts and
// e2e/ice.spec.ts.

let nextPc = 0;

/** Whether the fake browser reports `degradationPreference` (Firefox, probably Safari, don't). */
const browser = { reportsDegradation: true };

class FakeTransceiver {
  mid: string | null = null;
  /** What it receives; `sources` stands for the packets arriving lately. */
  readonly receiver = {
    track: null as unknown,
    sources: [] as unknown[],
    getSynchronizationSources() {
      return this.sources;
    },
  };
  /** What `setCodecPreferences` was last given. */
  codecPreferences: { mimeType: string }[] = [];
  setCodecPreferences(codecs: { mimeType: string }[]) {
    this.codecPreferences = codecs;
  }
  readonly sender: {
    track: unknown;
    /** What `getStats()` answers. */
    stats: Map<string, unknown>;
    /** How many times `setParameters` was called. */
    setCalls: number;
    getStats: () => Promise<Map<string, unknown>>;
    replaceTrack: (track: unknown) => Promise<void>;
    getParameters: () => Partial<RTCRtpSendParameters>;
    setParameters: (parameters: Partial<RTCRtpSendParameters>) => Promise<void>;
  };
  readonly init: RTCRtpTransceiverInit;
  constructor(track: unknown, init: RTCRtpTransceiverInit = {}) {
    this.init = init;
    let parameters: Partial<RTCRtpSendParameters> = { encodings: init.sendEncodings ?? [{}] };
    const sender = {
      track,
      stats: new Map<string, unknown>(),
      setCalls: 0,
      getStats: async () => sender.stats,
      replaceTrack: async (next: unknown) => {
        sender.track = next;
      },
      getParameters: () => {
        const reported = structuredClone(parameters);
        if (!browser.reportsDegradation) delete reported.degradationPreference;
        return reported;
      },
      setParameters: async (next: Partial<RTCRtpSendParameters>) => {
        sender.setCalls++;
        parameters = structuredClone(next);
      },
    };
    this.sender = sender;
  }
}

class FakePC {
  readonly id = nextPc++;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  /** The last negotiated local description (the pending offer is only `localDescription`). */
  currentLocalDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: unknown = null;
  ontrack: ((e: { transceiver: FakeTransceiver; track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  readonly transceivers: FakeTransceiver[] = [];
  configuration: RTCConfiguration;
  /** What `getStats()` answers. */
  stats = new Map<string, unknown>();
  /** How many times `restartIce()` was called. */
  iceRestarts = 0;
  /** Own transceivers given a mid by the pending local offer (unset again on rollback). */
  #offered: FakeTransceiver[] = [];
  #needed = false;
  #nextMid = 0;
  #version = 0;

  constructor(configuration: RTCConfiguration = {}) {
    this.configuration = configuration;
  }

  addTransceiver(trackOrKind: unknown, init?: RTCRtpTransceiverInit) {
    const t = new FakeTransceiver(typeof trackOrKind === "string" ? null : trackOrKind, init);
    this.transceivers.push(t);
    this.#needed = true;
    this.#maybeNegotiate();
    return t;
  }

  async setLocalDescription() {
    await Promise.resolve();
    if (this.signalingState === "have-remote-offer") {
      this.localDescription = { type: "answer", sdp: `o=- ${this.id} 1\r\n` };
      this.currentLocalDescription = this.localDescription;
      this.signalingState = "stable";
      this.#maybeNegotiate();
      return;
    }
    this.#needed = false;
    this.#offered = this.transceivers.filter((t) => t.mid === null);
    for (const t of this.#offered) t.mid = `${this.id}:${this.#nextMid++}`;
    const mids = this.transceivers.map((t) => t.mid);
    // Like a real offer, each one differs (its session version goes up).
    this.localDescription = {
      type: "offer",
      sdp: JSON.stringify([...mids, `v${this.#version++}`]),
    };
    this.signalingState = "have-local-offer";
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    await Promise.resolve();
    if (description.type === "answer") {
      if (this.signalingState !== "have-local-offer") throw new Error("answer while not offering");
      this.remoteDescription = description;
      this.currentLocalDescription = this.localDescription;
      this.signalingState = "stable";
      this.#maybeNegotiate();
      return;
    }
    if (this.signalingState === "have-local-offer") {
      // Implicit rollback: our offer's new transceivers need negotiating again.
      for (const t of this.#offered) t.mid = null;
      this.#needed ||= this.#offered.length > 0;
      this.signalingState = "stable";
    } else if (this.signalingState !== "stable") {
      throw new Error(`offer in ${this.signalingState}`);
    }
    this.remoteDescription = description;
    const mids = JSON.parse(description.sdp ?? "[]") as string[];
    for (const mid of mids.slice(0, -1)) {
      if (this.transceivers.some((t) => t.mid === mid)) continue;
      const t = new FakeTransceiver(null);
      t.mid = mid;
      this.transceivers.push(t);
      t.receiver.track = { id: `track ${mid}` };
      this.ontrack?.({ transceiver: t, track: t.receiver.track });
    }
    this.signalingState = "have-remote-offer";
  }

  /** ICE gathering finds a candidate: an answer already set gains it (offers aren't touched). */
  gather(candidate: string) {
    const grown = (d: RTCSessionDescriptionInit | null) =>
      d?.type === "answer" ? { ...d, sdp: `${d.sdp}a=candidate:${candidate}\r\n` } : d;
    this.localDescription = grown(this.localDescription);
    this.currentLocalDescription = grown(this.currentLocalDescription);
  }

  getReceivers() {
    return this.transceivers.map((t) => t.receiver);
  }
  async addIceCandidate() {}
  async getStats() {
    return this.stats;
  }
  getConfiguration() {
    return this.configuration;
  }
  setConfiguration(configuration: RTCConfiguration) {
    this.configuration = configuration;
  }
  restartIce() {
    this.iceRestarts++;
    this.#needed = true;
    this.#maybeNegotiate();
  }
  close() {
    this.signalingState = "closed";
  }

  /** What the ICE agent would do: move the connection state. */
  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    (this.onconnectionstatechange as (() => void) | null)?.();
  }

  #maybeNegotiate() {
    if (!this.#needed || this.signalingState !== "stable") return;
    setTimeout(() => {
      if (this.#needed && this.signalingState === "stable") this.onnegotiationneeded?.();
    });
  }
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve));
};

/** A page for `userId`, wired to the others through `network` (a relay that keeps order). */
function page(
  userId: string,
  network: Map<string, Mesh>,
  iceServers?: RTCIceServer[],
  codecs?: VideoCodecs,
  uplink?: number,
) {
  const events: MeshEvent[] = [];
  const pcs: FakePC[] = [];
  const sent: SignalPayload[] = [];
  const socket = { up: true };
  const mesh = new Mesh({
    selfId: userId,
    send: (to: string, payload: SignalPayload) => {
      // A page whose socket is reconnecting has its steps dropped, as `RealtimeClient` does.
      if (!socket.up) return false;
      sent.push(payload);
      setTimeout(() => network.get(to)?.receive(userId, payload));
      return true;
    },
    iceServers,
    codecs,
    uplink,
    RTCPeerConnection: class extends FakePC {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        pcs.push(this);
      }
    } as unknown as typeof RTCPeerConnection,
    log: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
  });
  network.set(userId, mesh);
  mesh.subscribe((event) => events.push(event));
  const tracks = (from: string) =>
    events.flatMap((e) => (e.type === "track" && e.userId === from ? [e.slot] : []));
  return { mesh, events, pcs, tracks, sent, socket };
}

const track = (name: string, contentHint = "") =>
  ({ id: name, contentHint }) as unknown as MediaStreamTrack;
const everyone = [{ userId: "ana" }, { userId: "bo" }];

/** ICE succeeds on every open connection of `pages` (the fake has no transport of its own). */
function connect(...pages: { pcs: FakePC[] }[]) {
  for (const pc of pages.flatMap((p) => p.pcs)) {
    if (pc.signalingState === "closed") continue;
    pc.connectionState = "connected";
    pc.onconnectionstatechange?.();
  }
}

/** What each of `pc`'s transceivers sends now. */
const sending = (pc: FakePC | undefined) => pc?.transceivers.map((t) => t.sender.track);

describe("Mesh", () => {
  it("connects each pair once, the impolite side offering first, and both send their mic", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    ana.mesh.setLocalTracks({ mic: track("ana mic") });
    ana.mesh.join(everyone);
    bo.mesh.join(everyone);
    await settle();

    expect(ana.mesh.peers()).toMatchObject([{ userId: "bo", polite: true }]);
    expect(bo.mesh.peers()).toMatchObject([{ userId: "ana", polite: false }]);
    expect(ana.tracks("bo")).toEqual(["mic"]);
    expect(bo.tracks("ana")).toEqual(["mic"]);
    expect(ana.pcs.map((pc) => pc.signalingState)).toEqual(["stable"]);
    expect(bo.pcs.map((pc) => pc.signalingState)).toEqual(["stable"]);
    // Only the mic: one transceiver each way.
    expect(ana.pcs[0]?.transceivers).toHaveLength(2);
  });

  it("mutes and unmutes by swapping the sender's track, without renegotiating", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    ana.mesh.join(everyone);
    bo.mesh.join(everyone);
    await settle();
    const sender = bo.pcs[0]?.transceivers[0]?.sender;
    const mic = track("bo mic");
    bo.mesh.setLocalTracks({ mic });
    await settle();
    expect(sender?.track).toBe(mic);
    bo.mesh.setLocalTracks({ mic: null });
    await settle();
    expect(sender?.track).toBeNull();
    expect(ana.tracks("bo")).toEqual(["mic"]);
    expect(bo.pcs[0]?.transceivers).toHaveLength(2);
  });

  it("settles offers made by both sides at once (glare) with perfect negotiation", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    ana.mesh.join(everyone);
    bo.mesh.join(everyone);
    await settle();

    ana.mesh.setLocalTracks({ cam: track("ana cam") });
    bo.mesh.setLocalTracks({ cam: track("bo cam") });
    await settle();

    expect(ana.tracks("bo")).toEqual(["mic", "cam"]);
    expect(bo.tracks("ana")).toEqual(["mic", "cam"]);
    expect([...ana.pcs, ...bo.pcs].map((pc) => pc.signalingState)).toEqual(["stable", "stable"]);
  });

  it("starts over with a peer whose page did (a reload or takeover), polite or impolite", async () => {
    for (const reloading of ["ana", "bo"]) {
      const network = new Map<string, Mesh>();
      const ana = page("ana", network);
      const bo = page("bo", network);
      ana.mesh.join(everyone);
      bo.mesh.join(everyone);
      await settle();

      const stays = reloading === "ana" ? bo : ana;
      (reloading === "ana" ? ana : bo).mesh.close();
      const again = page(reloading, network);
      again.mesh.join(everyone);
      await settle();

      expect(stays.pcs.map((pc) => pc.signalingState)).toEqual(["closed", "stable"]);
      expect(again.pcs.map((pc) => pc.signalingState)).toEqual(["stable"]);
      expect(again.tracks(stays === ana ? "ana" : "bo")).toEqual(["mic"]);
      expect(stays.tracks(reloading)).toEqual(["mic", "mic"]);
    }
  });

  it("answers the first offer once when a hello crosses it", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    // Bo's offer and ana's hello pass each other: bo sends its offer again, and ana ignores it.
    bo.mesh.join(everyone);
    ana.mesh.join(everyone);
    await settle();
    expect([...ana.pcs, ...bo.pcs].map((pc) => pc.signalingState)).toEqual(["stable", "stable"]);
    expect(ana.tracks("bo")).toEqual(["mic"]);
    expect(bo.tracks("ana")).toEqual(["mic"]);
  });

  it("recovers a first offer lost while its peer was away (their reconnect grace)", async () => {
    const network = new Map<string, Mesh>();
    // Bo (impolite) offers to ana before ana's page can hear it: the server drops it.
    const bo = page("bo", network);
    bo.mesh.join(everyone);
    await settle();
    expect(bo.pcs.map((pc) => pc.signalingState)).toEqual(["have-local-offer"]);

    // Ana arrives without an offer and says hello: bo sends it again.
    const ana = page("ana", network);
    ana.mesh.join(everyone);
    await settle();
    expect([...ana.pcs, ...bo.pcs].map((pc) => pc.signalingState)).toEqual(["stable", "stable"]);
    expect(ana.tracks("bo")).toEqual(["mic"]);
    expect(bo.tracks("ana")).toEqual(["mic"]);
  });

  it("pauses a camera towards a peer that isn't showing it, and resumes it when shown", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    const cy = page("cy", network);
    const room = [...everyone, { userId: "cy" }];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    connect(ana, bo, cy);
    const cam = track("ana cam");
    ana.mesh.setLocalTracks({ cam });
    await settle();
    // Ana's connections to bo and cy, in the order she opened them.
    const [toBo, toCy] = ana.pcs;
    expect(sending(toBo)).toContain(cam);

    bo.mesh.setVisible("ana", "cam", false);
    await settle();
    expect(sending(toBo)).not.toContain(cam);
    expect(sending(toCy)).toContain(cam);
    // Only the track is swapped: bo keeps it (muted), and nothing was renegotiated.
    expect(bo.tracks("ana")).toEqual(["mic", "cam"]);
    // Both mics and ana's camera.
    expect(toBo?.transceivers).toHaveLength(3);

    // A new camera track goes to cy only while bo still hides it.
    const next = track("ana cam 2");
    ana.mesh.setLocalTracks({ cam: next });
    await settle();
    expect(sending(toBo)).not.toContain(next);
    expect(sending(toCy)).toContain(next);

    bo.mesh.setVisible("ana", "cam", true);
    await settle();
    expect(sending(toBo)).toContain(next);
  });

  it("tells a peer what it hides once connected, and again after they start over", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    bo.mesh.setVisible("ana", "cam", false);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    connect(ana, bo);
    await settle();
    // The camera starts after bo hid it: its transceiver to bo starts with no track.
    const cam = track("ana cam");
    ana.mesh.setLocalTracks({ cam });
    await settle();
    expect(bo.tracks("ana")).toEqual(["mic", "cam"]);
    expect(sending(ana.pcs[0])).not.toContain(cam);

    // Ana reloads: her new page is told again once connected.
    ana.mesh.close();
    const again = page("ana", network);
    again.mesh.setLocalTracks({ cam });
    again.mesh.join(everyone);
    await settle();
    expect(sending(again.pcs[0])).toContain(cam);
    connect(again, bo);
    await settle();
    expect(sending(again.pcs[0])).not.toContain(cam);
  });

  it("resumes a camera shown again while the pair was down, even if that step was lost", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    connect(ana, bo);
    const cam = track("ana cam");
    ana.mesh.setLocalTracks({ cam });
    bo.mesh.setVisible("ana", "cam", false);
    await settle();
    expect(sending(ana.pcs[0])).not.toContain(cam);

    // ICE drops, and bo's "shown" step never reaches ana (the server dropped it).
    for (const pc of [...ana.pcs, ...bo.pcs]) {
      pc.connectionState = "disconnected";
      pc.onconnectionstatechange?.();
    }
    network.delete("ana");
    bo.mesh.setVisible("ana", "cam", true);
    await settle();
    expect(sending(ana.pcs[0])).not.toContain(cam);

    // Reconnected: bo says it all again, and ana resumes.
    network.set("ana", ana.mesh);
    connect(ana, bo);
    await settle();
    expect(sending(ana.pcs[0])).toContain(cam);
  });

  it("sends a share's screen tuned by its content hint, and its audio at 128 kbps", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const screen = track("ana screen", "text");
    const screenAudio = track("ana share audio");
    ana.mesh.setLocalTracks({ screen, screenAudio });
    await settle();
    expect(bo.tracks("ana")).toEqual(["mic", "screen", "screenAudio"]);
    const own = (pc: FakePC | undefined, sent: MediaStreamTrack) =>
      pc?.transceivers.find((t) => t.sender.track === sent);
    expect(own(ana.pcs[0], screen)?.sender.getParameters().degradationPreference).toBe(
      "maintain-resolution",
    );
    expect(own(ana.pcs[0], screenAudio)?.init.sendEncodings).toEqual([
      { maxBitrate: SHARE_AUDIO_BITRATE },
    ]);

    // Another share, for smooth motion: the same transceiver, retuned.
    const motion = track("ana screen 2", "motion");
    ana.mesh.setLocalTracks({ screen: motion });
    await settle();
    expect(own(ana.pcs[0], motion)?.sender.getParameters().degradationPreference).toBe(
      "maintain-framerate",
    );

    // Bo can tell whether its audio arrives: its track alone doesn't say.
    const shareAudioIn = bo.pcs[0]?.getReceivers().at(-1);
    expect(bo.mesh.receiving("ana", "screenAudio")).toBe(false);
    shareAudioIn?.sources.push({ source: 1 });
    expect(bo.mesh.receiving("ana", "screenAudio")).toBe(true);
    expect(bo.mesh.receiving("ana", "cam")).toBe(false);

    // Stopped: nothing is sent, and nothing renegotiated.
    ana.mesh.setLocalTracks({ screen: null, screenAudio: null });
    await settle();
    expect(sending(ana.pcs[0])).toEqual([null, null, null, null]);
    expect(bo.tracks("ana")).toEqual(["mic", "screen", "screenAudio"]);
  });

  it("closes a connection when its peer leaves, and every connection on close", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    page("bo", network);
    page("cy", network);
    const room = [...everyone, { userId: "cy" }];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    expect(ana.mesh.peers().map((p) => p.userId)).toEqual(["bo", "cy"]);

    ana.mesh.join(everyone);
    expect(ana.mesh.peers().map((p) => p.userId)).toEqual(["bo"]);
    expect(ana.events).toContainEqual({ type: "closed", userId: "cy" });
    ana.mesh.close();
    expect(ana.mesh.peers()).toEqual([]);
    expect(ana.pcs.map((pc) => pc.signalingState)).toEqual(["closed", "closed"]);
  });
});

describe("Mesh across socket reconnects (ADR 1)", () => {
  /** Ana and bo, negotiated. Ana is the polite side, bo the impolite one. */
  async function negotiated() {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    ana.mesh.join(everyone);
    bo.mesh.join(everyone);
    await settle();
    return { ana, bo };
  }

  /** The descriptions `p` has sent (after its first `from` steps). */
  const descriptions = (p: ReturnType<typeof page>, from = 0) =>
    p.sent.slice(from).flatMap((s) => (s.kind === "description" ? [s.description] : []));
  const kinds = (sent: { type: string }[]) => sent.map((d) => d.type);

  it("sends a share's offer again once the socket is back, from either side", async () => {
    for (const sharing of ["ana", "bo"] as const) {
      const { ana, bo } = await negotiated();
      const [sharer, viewer] = sharing === "ana" ? [ana, bo] : [bo, ana];
      sharer.socket.up = false;
      sharer.mesh.setLocalTracks({ screen: track(`${sharing} screen`) });
      await settle();
      // The offer was dropped: the viewer has nothing, and the sharer still waits for an answer.
      expect(viewer.tracks(sharing)).toEqual(["mic"]);
      expect(sharer.pcs[0]?.signalingState).toBe("have-local-offer");

      sharer.socket.up = true;
      sharer.mesh.resend();
      await settle();
      expect(viewer.tracks(sharing)).toEqual(["mic", "screen"]);
      expect([ana, bo].map((p) => p.pcs[0]?.signalingState)).toEqual(["stable", "stable"]);
    }
  });

  it("sends a dropped answer again with its candidates, then the offer that followed it", async () => {
    const { ana, bo } = await negotiated();
    ana.socket.up = false;
    // Bo's offer reaches ana, whose answer is dropped; her own offer after it is dropped too.
    bo.mesh.setLocalTracks({ cam: track("bo cam") });
    await settle();
    ana.mesh.setLocalTracks({ screen: track("ana screen") });
    await settle();
    expect(bo.pcs[0]?.signalingState).toBe("have-local-offer");
    // Candidates gathered meanwhile: the answer is the connection's current description, while
    // her offer is the pending one.
    ana.pcs[0]?.gather("1 udp 10.0.0.1 9");
    const before = ana.sent.length;

    ana.socket.up = true;
    ana.mesh.resend();
    await settle();
    const resent = descriptions(ana, before);
    expect(kinds(resent)).toEqual(["answer", "offer"]);
    expect(resent[0]?.sdp).toContain("a=candidate:1 udp 10.0.0.1 9");
    expect(bo.tracks("ana")).toEqual(["mic", "screen"]);
    expect(ana.tracks("bo")).toEqual(["mic", "cam"]);
    expect([ana, bo].map((p) => p.pcs[0]?.signalingState)).toEqual(["stable", "stable"]);
  });

  it("doesn't send an offer again once the peer's offer has replaced it (glare)", async () => {
    const { ana, bo } = await negotiated();
    ana.socket.up = false;
    ana.mesh.setLocalTracks({ screen: track("ana screen") });
    await settle();
    const stale = ana.pcs[0]?.localDescription?.sdp;
    expect(ana.pcs[0]?.signalingState).toBe("have-local-offer");
    // Bo's offer arrives meanwhile: ana (polite) rolls her offer back and answers it, and her
    // screen is offered again afterwards. Both of those are dropped, as the socket is down.
    bo.mesh.setLocalTracks({ cam: track("bo cam") });
    await settle();
    const before = ana.sent.length;

    ana.socket.up = true;
    ana.mesh.resend();
    await settle();
    const resent = descriptions(ana, before);
    expect(kinds(resent)).toEqual(["answer", "offer"]);
    expect(resent.map((d) => d.sdp)).not.toContain(stale);
    expect(bo.tracks("ana")).toEqual(["mic", "screen"]);
    expect(ana.tracks("bo")).toEqual(["mic", "cam"]);
    expect([ana, bo].map((p) => p.pcs[0]?.signalingState)).toEqual(["stable", "stable"]);
  });

  it("doesn't send a dropped offer the peer's offer rolled back, even if it is due", async () => {
    const { ana, bo } = await negotiated();
    ana.socket.up = false;
    ana.mesh.setLocalTracks({ screen: track("ana screen") });
    await settle();
    const stale = ana.pcs[0]?.localDescription?.sdp;
    // The socket is back (no `resend` yet) when bo's offer replaces ana's: her answer to it
    // goes, and her screen is offered afresh. The dropped offer is not sent after them.
    ana.socket.up = true;
    const before = ana.sent.length;
    bo.mesh.setLocalTracks({ cam: track("bo cam") });
    await settle();
    ana.mesh.resend();
    await settle();
    const resent = descriptions(ana, before);
    expect(kinds(resent)).toEqual(["answer", "offer"]);
    expect(resent.map((d) => d.sdp)).not.toContain(stale);
    expect(bo.tracks("ana")).toEqual(["mic", "screen"]);
    expect(ana.tracks("bo")).toEqual(["mic", "cam"]);
  });

  it("sends nothing again when nothing was dropped, or once it has been sent", async () => {
    const { ana } = await negotiated();
    ana.mesh.setLocalTracks({ screen: track("ana screen") });
    await settle();
    const sent = ana.sent.length;
    ana.mesh.resend();
    await settle();
    expect(ana.sent).toHaveLength(sent);

    ana.socket.up = false;
    ana.mesh.setLocalTracks({ cam: track("ana cam") });
    await settle();
    ana.socket.up = true;
    ana.mesh.resend();
    ana.mesh.resend();
    await settle();
    expect(ana.sent).toHaveLength(sent + 1);
  });
});

const trackWith = (name: string, settings: Partial<MediaTrackSettings> = {}, contentHint = "") =>
  ({ id: name, contentHint, getSettings: () => settings }) as unknown as MediaStreamTrack;

/** A video sender's stats, as `readSample` reads them (`sent`: its counters, for the bitrate). */
const senderStats = (
  loss: number,
  codec = "video/VP9",
  sent?: { bytesSent: number; timestamp: number },
  reason?: string,
) =>
  new Map<string, unknown>([
    ["t", { id: "t", type: "transport", selectedCandidatePairId: "p" }],
    ["p", { id: "p", type: "candidate-pair", availableOutgoingBitrate: 20_000_000 }],
    [
      "o",
      {
        id: "o",
        type: "outbound-rtp",
        kind: "video",
        codecId: "c",
        ...(reason && { qualityLimitationReason: reason }),
        ...sent,
      },
    ],
    ["c", { id: "c", type: "codec", mimeType: codec }],
    ["r", { id: "r", type: "remote-inbound-rtp", kind: "video", fractionLost: loss }],
  ]);

/** The transceiver of `pc` sending `sent`. */
const carrying = (pc: FakePC | undefined, sent: MediaStreamTrack) =>
  pc?.transceivers.find((t) => t.sender.track === sent);

describe("Mesh quality ladder (ADR 2)", () => {
  /** Ana shares a 1080p60 screen to bo and cy, all connected. */
  async function sharing() {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    const cy = page("cy", network);
    const room = [{ userId: "ana" }, { userId: "bo" }, { userId: "cy" }];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    const screen = trackWith("ana screen", { height: 1080, frameRate: 60 }, "motion");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, bo, cy);
    await settle();
    // Ana's connections are in the order she opened them: bo, cy.
    const [toBo, toCy] = ana.pcs.map((pc) => carrying(pc, screen)) as [
      FakeTransceiver,
      FakeTransceiver,
    ];
    return { ana, bo, toBo, toCy };
  }
  const rungs = (mesh: Mesh) => mesh.quality().map((q) => q.screen?.rung);

  it("starts each viewer's share at 1080p30, scaled from the capture", async () => {
    const { ana, toBo, toCy } = await sharing();
    for (const t of [toBo, toCy]) {
      expect(t.sender.getParameters().encodings?.[0]).toMatchObject({
        maxBitrate: SCREEN_LADDER[SCREEN_DEFAULT_RUNG]?.maxBitrate,
        maxFramerate: 30,
        scaleResolutionDownBy: 1,
      });
    }
    expect(rungs(ana.mesh)).toEqual(["1080p30", "1080p30"]);
    ana.mesh.close();
  });

  it("steps one viewer down on its own stats, and back up after a sustained good window", async () => {
    const { ana, toBo, toCy } = await sharing();
    toBo.sender.stats = senderStats(0.1);
    toCy.sender.stats = senderStats(0);
    // The bandwidth estimate is still ramping for the first readings, so nothing moves.
    for (let i = 0; i < 2; i++) await ana.mesh.adjust();
    expect(rungs(ana.mesh)).toEqual(["1080p30", "1080p30"]);
    await ana.mesh.adjust();
    await ana.mesh.adjust();
    // Only bo, whose link is lossy, drops (900p30, scaled from the 1080p capture).
    expect(ana.mesh.quality().map((q) => q.screen)).toEqual([
      { rung: "900p30", codec: "video/VP9" },
      { rung: "1080p30", codec: "video/VP9" },
    ]);
    expect(toBo.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 2_200_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1080 / 900,
    });
    expect(toCy.sender.getParameters().encodings?.[0]?.maxBitrate).toBe(3_000_000);

    // Clean again: it takes a full window to go back up.
    toBo.sender.stats = senderStats(0);
    for (let i = 0; i < UP_SAMPLES - 1; i++) await ana.mesh.adjust();
    expect(rungs(ana.mesh)[0]).toBe("900p30");
    await ana.mesh.adjust();
    expect(rungs(ana.mesh)[0]).toBe("1080p30");
    expect(toBo.sender.getParameters().encodings?.[0]?.maxBitrate).toBe(3_000_000);
    // The room kind's degradation preference survives the retuning.
    expect(toBo.sender.getParameters().degradationPreference).toBe("maintain-framerate");
    ana.mesh.close();
  });

  it("reaches 1080p60 on a fast link and goes no higher, and a new share starts over", async () => {
    const { ana, toBo } = await sharing();
    toBo.sender.stats = senderStats(0);
    for (let i = 0; i < 2 + UP_SAMPLES * 3; i++) await ana.mesh.adjust();
    expect(rungs(ana.mesh)[0]).toBe("1080p60");
    expect(toBo.sender.getParameters().encodings?.[0]).toMatchObject({ maxFramerate: 60 });

    ana.mesh.setLocalTracks({ screen: trackWith("ana screen 2", { height: 1080, frameRate: 60 }) });
    await settle();
    expect(rungs(ana.mesh)[0]).toBe("1080p30");
    ana.mesh.close();
  });

  it("caps a share at what its capture feeds, and drops the camera to 180p under pressure", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const screen = trackWith("small window", { height: 720, frameRate: 30 });
    const cam = trackWith("cam", { height: 360, frameRate: 15 });
    ana.mesh.setLocalTracks({ screen, cam });
    await settle();
    connect(ana, bo);
    await settle();
    const camera = carrying(ana.pcs[0], cam);
    expect(ana.mesh.quality()[0]).toMatchObject({
      screen: { rung: "720p30" },
      cam: { rung: "360p15" },
    });
    expect(camera?.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 500_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 1,
    });
    for (const t of ana.pcs[0]?.transceivers ?? []) t.sender.stats = senderStats(0.2);
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    // The screen is at its lowest rung already; the camera drops.
    expect(ana.mesh.quality()[0]).toMatchObject({
      screen: { rung: "720p30" },
      cam: { rung: "180p15" },
    });
    expect(camera?.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 150_000,
      scaleResolutionDownBy: 2,
    });
    ana.mesh.close();
  });

  it("puts a sender's parameters right again on the next pass, and restarts its readings when its track resumes", async () => {
    const { ana, bo, toBo } = await sharing();
    toBo.sender.stats = senderStats(0.1);
    // Something (a refused change, a resized capture) left the encoding off its rung.
    const stale = toBo.sender.getParameters();
    await toBo.sender.setParameters({
      ...stale,
      encodings: [{ ...stale.encodings?.[0], maxBitrate: 1, scaleResolutionDownBy: 3 }],
    });
    await ana.mesh.adjust();
    await settle();
    expect(toBo.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 3_000_000,
      scaleResolutionDownBy: 1,
    });

    // Warm-up is over after two more readings; a resumed track starts it again.
    await ana.mesh.adjust();
    bo.mesh.setVisible("ana", "screen", false);
    await settle();
    bo.mesh.setVisible("ana", "screen", true);
    await settle();
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    // 2 warm-up readings, then 2 lossy ones: one step down, not the two it would be without.
    expect(rungs(ana.mesh)[0]).toBe("900p30");
    ana.mesh.close();
  });

  it("adapts each viewer on its own, so one hung stats read doesn't stall the others", async () => {
    const { ana, toBo, toCy } = await sharing();
    // Bo's stats never come back; cy's link is lossy.
    toBo.sender.getStats = () => new Promise(() => {});
    toCy.sender.stats = senderStats(0.1);
    void ana.mesh.adjust();
    // Every pass skips bo and still finishes cy's: warm-up, then a step down.
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    expect(rungs(ana.mesh)).toEqual(["1080p30", "900p30"]);
    ana.mesh.close();
  });

  it("leaves a pair that isn't connected alone", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    ana.mesh.setLocalTracks({ screen: trackWith("s", { height: 1080, frameRate: 60 }) });
    await settle();
    let reads = 0;
    for (const t of ana.pcs[0]?.transceivers ?? []) {
      t.sender.getStats = async () => {
        reads++;
        return senderStats(0);
      };
    }
    await ana.mesh.adjust();
    expect(reads).toBe(0);
    ana.mesh.close();
  });
});

describe("Mesh uplink budget (ADR 2)", () => {
  const MBPS = 1_000_000;

  /**
   * Ana shares a 1080p60 screen (and, with `withCam`, a 360p15 camera) to `names` (all
   * connected), with `uplink` bits per second to spend.
   */
  async function crowd(names: string[], uplink?: number, withCam = false) {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, uplink);
    const viewers = names.map((name) => page(name, network));
    const room = [{ userId: "ana" }, ...names.map((userId) => ({ userId }))];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    const screen = trackWith("ana screen", { height: 1080, frameRate: 60 }, "motion");
    const cam = trackWith("ana cam", { height: 360, frameRate: 15 });
    ana.mesh.setLocalTracks(withCam ? { screen, cam } : { screen });
    await settle();
    connect(ana, ...viewers);
    await settle();
    // Ana's connections are in the order of `names`.
    const senders = ana.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    return { ana: ana.mesh, anaPage: ana, network, viewers, senders };
  }

  /**
   * One `adjust` pass in which every sender sends `share` of its rung's bitrate over a link
   * losing `loss` of its packets (by sender, if a function) and held back by `limit`; the uplink
   * budget afterwards.
   */
  const counters = new Map<FakeTransceiver, { bytes: number; at: number }>();
  async function pass(
    ana: Mesh,
    senders: FakeTransceiver[],
    {
      loss = 0,
      share = 1,
      limit,
    }: { loss?: number | ((sender: number) => number); share?: number; limit?: string } = {},
  ) {
    for (const [i, t] of senders.entries()) {
      const c = counters.get(t) ?? { bytes: 0, at: 0 };
      counters.set(t, c);
      const bitrate = (t.sender.getParameters().encodings?.[0]?.maxBitrate ?? 0) * share;
      c.at += QUALITY_INTERVAL_MS;
      c.bytes += (bitrate * QUALITY_INTERVAL_MS) / 8_000;
      const lost = typeof loss === "function" ? loss(i) : loss;
      t.sender.stats = senderStats(
        lost,
        "video/VP9",
        { bytesSent: c.bytes, timestamp: c.at },
        limit,
      );
    }
    await ana.adjust();
    await new Promise((resolve) => setTimeout(resolve));
    return ana.uplink();
  }
  const labels = (mesh: Mesh) => mesh.quality().map((q) => q.screen?.rung);
  const count = (list: (string | undefined)[], rung: string) =>
    list.filter((r) => r === rung).length;

  it("starts many viewers within the budget instead of every one at the top", async () => {
    // Five viewers at 1080p30 would be 15 Mbps: four get it, the fifth the rung that is left.
    const five = await crowd(["bo", "cy", "di", "ed", "fi"], 13.5 * MBPS);
    expect(five.ana.uplink()).toEqual({ budget: 13.5 * MBPS, targeted: 13.5 * MBPS });
    expect(count(labels(five.ana), "1080p30")).toBe(4);
    expect(count(labels(five.ana), "720p30")).toBe(1);
    five.ana.close();

    // A sixth finds no room, and starts at the lowest rung: the first pass sheds the excess.
    const six = await crowd(["bo", "cy", "di", "ed", "fi", "gu"], 13.5 * MBPS);
    expect(six.ana.uplink().targeted).toBeGreaterThan(13.5 * MBPS);
    expect(count(labels(six.ana), "720p30")).toBe(2);
    expect((await pass(six.ana, six.senders)).targeted).toBeLessThanOrEqual(13.5 * MBPS);
    six.ana.close();

    // With the default budget, nine viewers (ADR 2's worst case, 27 Mbps at the top) fit too.
    const nine = await crowd(["bo", "cy", "di", "ed", "fi", "gu", "hu", "io", "jo"]);
    const { budget, targeted } = await pass(nine.ana, nine.senders);
    expect(targeted).toBeLessThanOrEqual(budget);
    expect(labels(nine.ana)).toHaveLength(9);
    nine.ana.close();
  });

  it("lowers the budget and the total when most pairs are strained, to what was being sent", async () => {
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed", "fi", "gu"], 18 * MBPS);
    expect(ana.uplink().targeted).toBe(18 * MBPS);
    // Warm-up, then two readings in which every link loses packets and carries 95% of its target.
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    expect(ana.uplink()).toEqual({ budget: 18 * MBPS, targeted: 18 * MBPS });
    await pass(ana, senders, { loss: 0.1, share: 0.95 });
    const { budget, targeted } = await pass(ana, senders, { loss: 0.1, share: 0.95 });
    expect(budget).toBeCloseTo(18 * MBPS * 0.95 * UPLINK_SHARE, -3);
    expect(targeted).toBeLessThanOrEqual(budget);
    expect(targeted).toBeLessThan(18 * MBPS);
    ana.close();
  });

  it("doesn't let a quiet scene collapse the budget: one drop is bounded", async () => {
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed", "fi", "gu"], 30 * MBPS);
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    // A still screen sends 5% of its target, then a loss spike hits every link.
    await pass(ana, senders, { loss: 0.1, share: 0.05 });
    const { budget, targeted } = await pass(ana, senders, { loss: 0.1, share: 0.05 });
    expect(budget).toBeCloseTo(30 * MBPS * UPLINK_DROP_LIMIT, -3);
    // The pairs step down for their own loss, one rung, but nobody is thrown to the bottom.
    expect(labels(ana)).toEqual(Array(6).fill("900p30"));
    expect(targeted).toBeLessThanOrEqual(budget);
    ana.close();
  });

  it("leaves a CPU-bound encoder to its own pairs: it doesn't cut the uplink budget", async () => {
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed", "fi", "gu"], 30 * MBPS);
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    await pass(ana, senders, { limit: "cpu" });
    const { budget } = await pass(ana, senders, { limit: "cpu" });
    expect(budget).toBe(30 * MBPS);
    // Each pair still steps down for it.
    expect(labels(ana)).toEqual(Array(6).fill("900p30"));
    ana.close();
  });

  it("leaves one bad link to its own pair, whatever the budget", async () => {
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed"], 20 * MBPS);
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    const bad = senders.slice(0, 1);
    for (let i = 0; i < 2; i++) {
      for (const t of senders.slice(1)) t.sender.stats = senderStats(0);
      await pass(ana, bad, { loss: 0.2 });
    }
    expect(ana.uplink().budget).toBe(20 * MBPS);
    expect(labels(ana).sort()).toEqual(["1080p30", "1080p30", "1080p30", "900p30"]);
    ana.close();
  });

  it("lets no pair probe past the budget, and only one at a time once a clean spell allows", async () => {
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed"], 12 * MBPS);
    expect(ana.uplink()).toEqual({ budget: 12 * MBPS, targeted: 12 * MBPS });
    // Clean links all the while. The pairs are due for a probe after the warm-up and a window,
    // but the budget is full: nobody goes up yet.
    for (let i = 0; i < 2 + UP_SAMPLES; i++) {
      const { budget, targeted } = await pass(ana, senders);
      expect(targeted).toBeLessThanOrEqual(budget);
    }
    expect(count(labels(ana), "1080p30")).toBe(4);
    // Then one pair probes (the budget grows by that probe only), the others still wait.
    expect(await pass(ana, senders)).toEqual({ budget: 13.5 * MBPS, targeted: 13.5 * MBPS });
    expect(count(labels(ana), "1080p45")).toBe(1);
    expect(count(labels(ana), "1080p30")).toBe(3);
    // And so on, never past the budget at any pass.
    for (let i = 0; i < 40; i++) {
      const { budget, targeted } = await pass(ana, senders);
      expect(targeted).toBeLessThanOrEqual(budget);
    }
    expect(ana.uplink().budget).toBeGreaterThan(13.5 * MBPS);
    ana.close();
  });

  it("recovers when the pressure clears, and never past the budget", async () => {
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed", "fi", "gu"], 18 * MBPS);
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    await pass(ana, senders, { loss: 0.1, share: 0.95 });
    const low = await pass(ana, senders, { loss: 0.1, share: 0.95 });
    expect(low.budget).toBeLessThan(18 * MBPS);

    // Clean again: nothing jumps back at once, and the total climbs without passing the budget.
    expect(await pass(ana, senders)).toEqual(low);
    for (let i = 0; i < 60; i++) {
      const { budget, targeted } = await pass(ana, senders);
      expect(targeted).toBeLessThanOrEqual(budget);
    }
    const recovered = ana.uplink();
    expect(recovered.budget).toBeGreaterThan(low.budget);
    expect(recovered.targeted).toBeGreaterThan(low.targeted);
    ana.close();
  });

  it("starts from the floor ADR 2 assumes, less an allowance for audio", async () => {
    const { ana } = await crowd(["bo"]);
    expect(ana.uplink().budget).toBe(INITIAL_UPLINK);
    expect(INITIAL_UPLINK).toBeLessThan(UPLINK_FLOOR);
    ana.close();
  });

  it("lets healthy viewers grow the budget past a mediocre one (lossy, but not pressured)", async () => {
    // Ed's share starts lowest (what was left), and his link loses 2%: not strained, not clean.
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed"], 11.2 * MBPS);
    expect(labels(ana)).toEqual(["1080p30", "1080p30", "1080p30", "900p30"]);
    const options = { loss: (i: number) => (i === 3 ? 0.02 : 0) };
    for (let i = 0; i < 2 + UP_SAMPLES; i++) await pass(ana, senders, options);
    expect(await pass(ana, senders, options)).toEqual({
      budget: 12.7 * MBPS,
      targeted: 12.7 * MBPS,
    });
    expect(count(labels(ana), "1080p45")).toBe(1);
    expect(labels(ana)[3]).toBe("900p30");
    ana.close();
  });

  it("doesn't wait on a pair that isn't connected to take its turn", async () => {
    const { ana, anaPage, senders } = await crowd(["bo", "cy", "di", "ed"], 11.2 * MBPS);
    for (let i = 0; i < 2 + UP_SAMPLES; i++) await pass(ana, senders);
    // Ed has been clean for a window on the lowest rung, and now his connection drops.
    anaPage.pcs[3]?.setConnectionState("disconnected");
    expect(await pass(ana, senders)).toEqual({ budget: 12.7 * MBPS, targeted: 12.7 * MBPS });
    expect(count(labels(ana), "1080p45")).toBe(1);
    ana.close();
  });

  it("brings a resumed camera back through the budget, so nobody else steps down", async () => {
    const { ana, anaPage, network, viewers } = await crowd(["bo", "cy", "di"], 12.9 * MBPS, true);
    expect(ana.uplink().targeted).toBe(10.5 * MBPS);
    const [bo] = viewers;
    bo?.mesh.setVisible("ana", "cam", false);
    await settle();
    expect(ana.uplink().targeted).toBe(10 * MBPS);
    // Meanwhile a newcomer takes what room there is: a 900p30 share and a 360p15 camera.
    const ed = page("ed", network);
    const room = ["ana", "bo", "cy", "di", "ed"].map((userId) => ({ userId }));
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    connect(anaPage, ed);
    await settle();
    expect(ana.uplink().targeted).toBe(12.7 * MBPS);
    expect(ana.quality()[3]).toMatchObject({ screen: { rung: "900p30" }, cam: { rung: "360p15" } });

    // Bo shows the camera again: it comes back at the rung that fits, and nobody else moves.
    bo?.mesh.setVisible("ana", "cam", true);
    await settle();
    await ana.adjust();
    await settle();
    expect(ana.quality()[0]?.cam?.rung).toBe("180p15");
    expect(labels(ana)).toEqual(["1080p30", "1080p30", "1080p30", "900p30"]);
    const { budget, targeted } = ana.uplink();
    expect(targeted).toBeLessThanOrEqual(budget);
    ana.close();
  });

  describe("with a pair whose stats read hasn't returned (the #74 guard)", () => {
    /** Four viewers at 12 Mbps; the first one's stats hang after the warm-up. */
    async function hung() {
      const { ana, senders } = await crowd(["bo", "cy", "di", "ed"], 12 * MBPS);
      for (let i = 0; i < 2; i++) await pass(ana, senders);
      (senders[0] as FakeTransceiver).sender.getStats = () => new Promise(() => {});
      // This pass never finishes (it waits on the first pair), but the others' parts do.
      void ana.adjust();
      await new Promise((resolve) => setTimeout(resolve));
      return { ana, healthy: senders.slice(1) };
    }

    it("counts what it was last sending, so the budget doesn't drop too deep", async () => {
      const { ana, healthy } = await hung();
      await pass(ana, healthy, { loss: 0.1, share: 0.95 });
      const { budget } = await pass(ana, healthy, { loss: 0.1, share: 0.95 });
      // Its 3 Mbps and the other three's 95% of 3 Mbps each, not just the three.
      expect(budget).toBeCloseTo((3 + 3 * 2.85) * MBPS * UPLINK_SHARE, -3);
      ana.close();
    });

    it("leaves it alone while fitting the others to a lower budget", async () => {
      const { ana, healthy } = await hung();
      await pass(ana, healthy, { loss: 0.1, share: 0.6 });
      const { budget, targeted } = await pass(ana, healthy, { loss: 0.1, share: 0.6 });
      expect(budget).toBeCloseTo(12 * MBPS * UPLINK_DROP_LIMIT, -3);
      expect(targeted).toBeLessThanOrEqual(budget);
      // The heaviest sender is the hung pair's, which isn't stepped down mid-read.
      expect(labels(ana)[0]).toBe("1080p30");
      ana.close();
    });
  });

  it("applies encoder parameters only when they change, on a browser that doesn't report degradationPreference", async () => {
    browser.reportsDegradation = false;
    try {
      const { ana, senders } = await crowd(["bo", "cy"]);
      for (const t of senders) {
        // Set once for the share's content hint, though the browser never says it has it.
        expect(t.sender.setCalls).toBe(1);
        expect(t.sender.getParameters().degradationPreference).toBeUndefined();
      }
      // Warm-up and a clean window: no rung changes yet, so nothing to apply.
      for (let i = 0; i < 2 + UP_SAMPLES - 1; i++) await pass(ana, senders);
      for (const t of senders) expect(t.sender.setCalls).toBe(1);

      // A share with another content hint is a real change, made once.
      ana.setLocalTracks({
        screen: trackWith("ana screen 2", { height: 1080, frameRate: 60 }, "text"),
      });
      await settle();
      for (let i = 0; i < 4; i++) await pass(ana, senders);
      for (const t of senders) expect(t.sender.setCalls).toBe(2);
      ana.close();
    } finally {
      browser.reportsDegradation = true;
    }
  });
});

describe("Mesh codec choice (ADR 2)", () => {
  const codec = (mimeType: string) => ({ mimeType, clockRate: 90_000 });
  const chromium: VideoCodecs = {
    send: [codec("video/VP8"), codec("video/AV1"), codec("video/VP9"), codec("video/rtx")],
    receive: ["video/VP8", "video/AV1", "video/VP9"],
  };
  const firefox: VideoCodecs = {
    send: [codec("video/VP8"), codec("video/VP9"), codec("video/rtx")],
    receive: ["video/VP8", "video/VP9"],
  };
  const sender = (pc: FakePC | undefined) => pc?.transceivers.find((t) => t.sender.track);

  it("tells peers what it can decode, and offers each the best codec both have", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, chromium);
    const bo = page("bo", network, undefined, firefox);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    ana.mesh.setLocalTracks({ screen: trackWith("s", { height: 1080, frameRate: 60 }) });
    bo.mesh.setLocalTracks({ cam: trackWith("c", { height: 360, frameRate: 15 }) });
    await settle();
    // Ana (Chromium) leaves AV1 out for Bo (Firefox), who can't decode it.
    expect(sender(ana.pcs[0])?.codecPreferences.map((c) => c.mimeType)).toEqual([
      "video/VP9",
      "video/VP8",
      "video/rtx",
    ]);
    // Bo sends VP9 first, though Ana would take AV1.
    expect(sender(bo.pcs[0])?.codecPreferences.map((c) => c.mimeType)).toEqual([
      "video/VP9",
      "video/VP8",
      "video/rtx",
    ]);
  });

  it("offers everything, best first, until the peer has said what it decodes", async () => {
    const network = new Map<string, Mesh>();
    const bo = page("bo", network, undefined, chromium);
    // Ana (the polite side) isn't there to say anything.
    bo.mesh.join(everyone);
    bo.mesh.setLocalTracks({ screen: trackWith("s") });
    await settle();
    expect(sender(bo.pcs[0])?.codecPreferences.map((c) => c.mimeType)).toEqual([
      "video/AV1",
      "video/VP9",
      "video/VP8",
      "video/rtx",
    ]);
    bo.mesh.close();
  });
});

describe("Mesh ICE (ADR 3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run relayed signalling and negotiationneeded (each a 1ms timer), 20ms in all. */
  const tick = async () => {
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
  };

  const turn: RTCIceServer[] = [{ urls: "turn:turn.example:3478", username: "u", credential: "c" }];

  /** Ana and bo, negotiated (not yet connected), with fake timers. */
  async function pair() {
    vi.useFakeTimers();
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, turn);
    const bo = page("bo", network, turn);
    ana.mesh.join(everyone);
    bo.mesh.join(everyone);
    await tick();
    return { ana, bo, anaPc: ana.pcs[0] as FakePC, boPc: bo.pcs[0] as FakePC };
  }

  const states = (p: ReturnType<typeof page>) =>
    p.events.flatMap((e) => (e.type === "state" ? [e.state] : []));

  /** A selected pair from a relay candidate (TLS to the TURN server) to a server-reflexive one. */
  const relayStats = () =>
    new Map<string, unknown>(
      [
        { id: "T", type: "transport", selectedCandidatePairId: "P" },
        { id: "P", type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R" },
        {
          id: "H",
          type: "local-candidate",
          candidateType: "host",
          protocol: "udp",
          address: "10.0.0.2",
        },
        {
          id: "L",
          type: "local-candidate",
          candidateType: "relay",
          protocol: "udp",
          relayProtocol: "tls",
          address: "104.30.0.1",
        },
        {
          id: "R",
          type: "remote-candidate",
          candidateType: "srflx",
          protocol: "udp",
          address: "1.2.3.4",
        },
      ].map((s) => [s.id, s]),
    );

  it("connects with the ICE servers, and hands fresh ones to existing connections", async () => {
    const { ana, anaPc } = await pair();
    expect(anaPc.configuration.iceServers).toEqual(turn);
    const fresh = [{ urls: "turn:turn.example:3478", username: "u2", credential: "c2" }];
    ana.mesh.setIceServers(fresh);
    expect(anaPc.configuration.iceServers).toEqual(fresh);
  });

  it("reports connected, or relayed with its anonymised ICE path when the pair uses TURN", async () => {
    const { ana, bo, anaPc, boPc } = await pair();
    anaPc.setConnectionState("connected");
    boPc.stats = relayStats();
    boPc.setConnectionState("connected");
    await tick();
    expect(states(ana)).toEqual(["connecting", "connected"]);
    expect(states(bo)).toEqual(["connecting", "relayed"]);
    expect(bo.events.at(-1)).toEqual({
      type: "state",
      userId: "ana",
      state: "relayed",
      ice: {
        selected: {
          local: { type: "relay", protocol: "udp", relayProtocol: "tls" },
          remote: { type: "srflx", protocol: "udp" },
        },
        local: [
          { type: "host", protocol: "udp" },
          { type: "relay", protocol: "udp", relayProtocol: "tls" },
        ],
        remote: [{ type: "srflx", protocol: "udp" }],
      },
    });
    expect(JSON.stringify(bo.events)).not.toMatch(/10\.0\.0\.2|104\.30|1\.2\.3\.4/);
    expect(bo.mesh.peers()).toMatchObject([{ userId: "ana", state: "relayed" }]);
  });

  it("restarts ICE once when a connection fails, then reports failed until retried", async () => {
    const { ana, bo, anaPc, boPc } = await pair();
    anaPc.setConnectionState("connected");
    boPc.setConnectionState("connected");
    await tick();
    const fresh = [
      { urls: "turns:turn.example:443?transport=tcp", username: "u2", credential: "c2" },
    ];
    ana.mesh.setIceServers(fresh);

    // Fails: an ICE restart, renegotiated with bo, with the latest ICE servers.
    const offerBefore = boPc.remoteDescription?.sdp;
    anaPc.setConnectionState("failed");
    await tick();
    expect(anaPc.iceRestarts).toBe(1);
    expect(anaPc.configuration.iceServers).toEqual(fresh);
    expect(boPc.remoteDescription?.sdp).not.toBe(offerBefore);
    expect([anaPc.signalingState, boPc.signalingState]).toEqual(["stable", "stable"]);
    expect(states(ana)).toEqual(["connecting", "connected", "connecting"]);

    // Fails again: that's it, with what ICE tried.
    anaPc.setConnectionState("failed");
    await tick();
    expect(anaPc.iceRestarts).toBe(1);
    expect(states(ana)).toEqual(["connecting", "connected", "connecting", "failed"]);
    expect(ana.events.at(-1)).toMatchObject({ state: "failed", ice: { local: [], remote: [] } });

    // Retry starts over, and bo does too: new connections on both sides.
    ana.mesh.retry("bo");
    await tick();
    expect(ana.events).toContainEqual({ type: "closed", userId: "bo" });
    expect([anaPc.signalingState, boPc.signalingState]).toEqual(["closed", "closed"]);
    expect([ana.pcs[1]?.signalingState, bo.pcs[1]?.signalingState]).toEqual(["stable", "stable"]);
    expect(bo.tracks("ana")).toEqual(["mic", "mic"]);
    expect(states(ana).at(-1)).toBe("connecting");
    expect(ana.tracks("bo")).toEqual(["mic", "mic"]);
  });

  it("restarts ICE when connecting takes too long, and again after reconnecting", async () => {
    const { ana, anaPc } = await pair();
    // The timeout runs from when the connection opened, before the pair's `tick`.
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1_000);
    expect(anaPc.iceRestarts).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await tick();
    expect(anaPc.iceRestarts).toBe(1);

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await tick();
    expect(states(ana)).toEqual(["connecting", "failed"]);

    // It connects after all (the peer restarted, say); a later drop restarts again.
    anaPc.setConnectionState("connected");
    await tick();
    anaPc.setConnectionState("disconnected");
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await tick();
    expect(anaPc.iceRestarts).toBe(2);
    expect(states(ana)).toEqual(["connecting", "failed", "connected", "connecting"]);
  });

  it("restarts ICE for failed pairs when TURN arrives after a STUN-only start", async () => {
    vi.useFakeTimers();
    const network = new Map<string, Mesh>();
    const stun = [{ urls: "stun:stun.example:3478" }];
    const ana = page("ana", network, stun);
    const bo = page("bo", network, stun);
    ana.mesh.join(everyone);
    bo.mesh.join(everyone);
    await tick();
    const [anaPc, boPc] = [ana.pcs[0] as FakePC, bo.pcs[0] as FakePC];
    anaPc.setConnectionState("connected");
    boPc.setConnectionState("connected");
    await tick();

    // It fails, restarts once on STUN, and fails for good.
    anaPc.setConnectionState("failed");
    await tick();
    anaPc.setConnectionState("failed");
    await tick();
    expect(anaPc.iceRestarts).toBe(1);
    expect(states(ana).at(-1)).toBe("failed");

    // More STUN changes nothing; TURN arriving restarts the pair with it.
    ana.mesh.setIceServers([{ urls: "stun:other.example:3478" }]);
    await tick();
    expect(anaPc.iceRestarts).toBe(1);
    ana.mesh.setIceServers(turn);
    await tick();
    expect(anaPc.iceRestarts).toBe(2);
    expect(anaPc.configuration.iceServers).toEqual(turn);
    expect(states(ana).at(-1)).toBe("connecting");
    expect([anaPc.signalingState, boPc.signalingState]).toEqual(["stable", "stable"]);

    // It connects; fresh TURN credentials later restart nothing, and neither do pairs that
    // never failed.
    anaPc.setConnectionState("connected");
    await tick();
    ana.mesh.setIceServers([{ ...turn[0], credential: "c2" } as RTCIceServer]);
    bo.mesh.setIceServers(turn);
    await tick();
    expect([anaPc.iceRestarts, boPc.iceRestarts]).toEqual([2, 0]);
  });

  it("starts a pair that never negotiated over once, then fails it with no ICE path", async () => {
    vi.useFakeTimers();
    const network = new Map<string, Mesh>();
    // Bo's offers go nowhere: ana's page isn't there.
    const bo = page("bo", network);
    bo.mesh.join(everyone);
    await tick();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await tick();
    // No ICE to restart: a new connection (a new session) instead.
    expect(bo.pcs.map((pc) => [pc.signalingState, pc.iceRestarts])).toEqual([
      ["closed", 0],
      ["have-local-offer", 0],
    ]);
    expect(bo.events.slice(1)).toEqual([
      { type: "closed", userId: "ana" },
      { type: "state", userId: "ana", state: "connecting" },
    ]);

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await tick();
    expect(bo.pcs).toHaveLength(2);
    expect(bo.pcs[1]?.iceRestarts).toBe(0);
    // A signalling stall, not an ICE failure: no ICE path, so nothing is reported.
    expect(bo.events.at(-1)).toEqual({ type: "state", userId: "ana", state: "failed" });
  });

  it("leaves a failed pair that never negotiated alone when TURN arrives", async () => {
    vi.useFakeTimers();
    const network = new Map<string, Mesh>();
    // Bo starts on STUN alone, and its offers go nowhere: ana's page isn't there.
    const bo = page("bo", network);
    bo.mesh.join(everyone);
    await tick();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2);
    await tick();
    expect(states(bo).at(-1)).toBe("failed");
    const events = bo.events.length;

    // A signalling stall isn't something TURN fixes: there is no ICE to restart.
    bo.mesh.setIceServers(turn);
    await tick();
    expect(bo.pcs.map((pc) => pc.iceRestarts)).toEqual([0, 0]);
    expect(bo.events).toHaveLength(events);
    expect(bo.pcs[1]?.configuration.iceServers).toEqual(turn);
  });

  it("connects a stalled pair when its start-over gets through", async () => {
    vi.useFakeTimers();
    const network = new Map<string, Mesh>();
    const bo = page("bo", network);
    const ana = page("ana", network);
    // Everything bo sends ana is lost for now; ana's hello reaches bo.
    network.delete("ana");
    bo.mesh.join(everyone);
    ana.mesh.join(everyone);
    await tick();
    network.set("ana", ana.mesh);
    expect(bo.pcs[0]?.signalingState).toBe("have-local-offer");

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await tick();
    expect(bo.events).toContainEqual({ type: "closed", userId: "ana" });
    const open = (p: typeof ana) => p.pcs.filter((pc) => pc.signalingState !== "closed");
    expect(open(ana).map((pc) => pc.signalingState)).toEqual(["stable"]);
    expect(open(bo).map((pc) => pc.signalingState)).toEqual(["stable"]);
    expect(ana.tracks("bo")).toEqual(["mic"]);
    expect(bo.tracks("ana")).toEqual(["mic"]);
    expect([...ana.pcs, ...bo.pcs].every((pc) => pc.iceRestarts === 0)).toBe(true);
  });

  it("stops timing a retried connection on close", async () => {
    vi.useFakeTimers();
    const network = new Map<string, Mesh>();
    const bo = page("bo", network);
    bo.mesh.join(everyone);
    await tick();
    bo.mesh.retry("ana");
    await tick();
    bo.mesh.close();
    const events = bo.events.length;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2);
    expect(bo.events).toHaveLength(events);
    expect(bo.pcs[1]?.iceRestarts).toBe(0);
  });
});

describe("degradationFor", () => {
  it("keeps resolution for detail and text, and frames for motion", () => {
    expect(degradationFor("detail")).toBe("maintain-resolution");
    expect(degradationFor("text")).toBe("maintain-resolution");
    expect(degradationFor("motion")).toBe("maintain-framerate");
  });
});

describe("withStereoOpus", () => {
  const sdp = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
    "a=mid:0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=mid:1",
    "a=rtpmap:96 VP8/90000",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=mid:3",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;stereo=0;useinbandfec=1",
    "",
  ].join("\r\n");

  it("asks for stereo at 128 kbps in the share audio's m-section only", () => {
    const lines = sdp.split("\r\n");
    lines[12] = "a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000";
    expect(withStereoOpus(sdp, new Set(["3"]))).toBe(lines.join("\r\n"));
  });

  it("adds Opus parameters where there were none, and leaves other SDP as it is", () => {
    const bare = sdp.replace("a=fmtp:111 minptime=10;stereo=0;useinbandfec=1\r\n", "");
    expect(withStereoOpus(bare, new Set(["3"]))).toContain(
      "a=mid:3\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;maxaveragebitrate=128000\r\n",
    );
    expect(withStereoOpus(sdp, new Set())).toBe(sdp);
    expect(withStereoOpus(sdp, new Set(["1"]))).toBe(sdp);
  });
});

describe("isSameOffer", () => {
  const offer = "v=0\r\no=- 7 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n";

  it("recognises an offer sent again with more ICE candidates", () => {
    expect(isSameOffer(`${offer}a=candidate:1 1 udp 1 10.0.0.1 9 typ host\r\n`, offer)).toBe(true);
  });

  it("tells a new offer apart by its version", () => {
    expect(isSameOffer(offer.replace("- 7 2", "- 7 3"), offer)).toBe(false);
    expect(isSameOffer(offer, undefined)).toBe(false);
  });
});
