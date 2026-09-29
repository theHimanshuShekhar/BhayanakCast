import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_TIMEOUT_MS,
  degradationFor,
  isSameOffer,
  Mesh,
  type MeshEvent,
  SHARE_AUDIO_BITRATE,
  withStereoOpus,
} from "./mesh";
import type { SignalPayload } from "./realtime";

// The Mesh's negotiation (#34) against a fake RTCPeerConnection that keeps the signalling state
// machine (offers, answers, implicit rollback, negotiationneeded) but carries no media; tests
// set its connection state and stats. Real browsers are covered by e2e/voice.spec.ts and
// e2e/ice.spec.ts.

let nextPc = 0;

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
  readonly sender: {
    track: unknown;
    replaceTrack: (track: unknown) => Promise<void>;
    getParameters: () => Partial<RTCRtpSendParameters>;
    setParameters: (parameters: Partial<RTCRtpSendParameters>) => Promise<void>;
  };
  constructor(
    track: unknown,
    readonly init: RTCRtpTransceiverInit = {},
  ) {
    let parameters: Partial<RTCRtpSendParameters> = { encodings: init.sendEncodings ?? [{}] };
    const sender = {
      track,
      replaceTrack: async (next: unknown) => {
        sender.track = next;
      },
      getParameters: () => structuredClone(parameters),
      setParameters: async (next: Partial<RTCRtpSendParameters>) => {
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
      this.localDescription = { type: "answer", sdp: "" };
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
function page(userId: string, network: Map<string, Mesh>, iceServers?: RTCIceServer[]) {
  const events: MeshEvent[] = [];
  const pcs: FakePC[] = [];
  const mesh = new Mesh({
    selfId: userId,
    send: (to: string, payload: SignalPayload) =>
      setTimeout(() => network.get(to)?.receive(userId, payload)),
    iceServers,
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
  return { mesh, events, pcs, tracks };
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
