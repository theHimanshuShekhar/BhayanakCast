import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIREFOX_START,
  HARDWARE_H264_START,
  HARDWARE_VP9_START,
  NORMAL_START,
  type StartOrder,
  type VideoCodecs,
} from "./codecs";
import type { ConnectionEvent } from "./connection-events";
import type { QualityView } from "./mesh";
import {
  CODEC_SWITCH_STAGGER_MS,
  CONNECT_TIMEOUT_MS,
  degradationFor,
  isSameOffer,
  Mesh,
  type MeshEvent,
  type MeshOptions,
  QUALITY_INTERVAL_MS,
  SHARE_AUDIO_BITRATE,
  sentCodecOf,
  withStartBitrate,
  withStereoOpus,
} from "./mesh";
import {
  FIRST_MINUTE_MS,
  INITIAL_UPLINK,
  UP_SAMPLES,
  UPLINK_DROP_LIMIT,
  UPLINK_FLOOR,
  UPLINK_SHARE,
} from "./quality";
import type { PendingSample } from "./quality-telemetry";
import type { SignalPayload } from "./realtime";

// The Mesh's negotiation (#34) against a fake RTCPeerConnection that keeps the signalling state
// machine (offers, answers, implicit rollback, negotiationneeded) but carries no media; tests
// set its connection state and stats. Real browsers are covered by e2e/voice.spec.ts and
// e2e/ice.spec.ts.

let nextPc = 0;

/**
 * What the fake browser supports: reporting `degradationPreference` (Firefox, probably Safari,
 * don't) and taking `encodings[].codec` (Chromium 119+ and Firefox 142+ do; Safari doesn't).
 */
const browser = { reportsDegradation: true, takesEncodingCodec: true };

class FakeTransceiver {
  mid: string | null = null;
  /** What it receives; `sources` stands for the packets arriving lately. */
  readonly receiver = {
    track: null as unknown,
    sources: [] as unknown[],
    getSynchronizationSources() {
      return this.sources;
    },
    /** What `getStats()` answers. */
    stats: new Map<string, unknown>(),
    async getStats() {
      return this.stats;
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
    /** The codecs `getParameters()` reports: none until a description is negotiated. */
    codecs?: { mimeType: string }[];
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
      codecs: undefined as { mimeType: string }[] | undefined,
      getStats: async () => sender.stats,
      replaceTrack: async (next: unknown) => {
        sender.track = next;
      },
      getParameters: () => {
        const reported = structuredClone(parameters);
        if (sender.codecs) reported.codecs = sender.codecs as RTCRtpCodecParameters[];
        if (!browser.reportsDegradation) delete reported.degradationPreference;
        return reported;
      },
      setParameters: async (next: Partial<RTCRtpSendParameters>) => {
        sender.setCalls++;
        parameters = structuredClone(next);
        if (!browser.takesEncodingCodec) {
          for (const encoding of parameters.encodings ?? []) {
            delete (encoding as { codec?: unknown }).codec;
          }
        }
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
  /** The text of every remote description it was given, as the Mesh gave it. */
  readonly remoteSdps: string[] = [];
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
    this.remoteSdps.push(description.sdp ?? "");
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
  extra: Partial<MeshOptions> = {},
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
    // The tests of the controller run in no time at all: unless one says otherwise, no sender is
    // in its first minute (`paceOf`).
    firstMinuteMs: 0,
    // Anything logged is a failure, unless a test expects it.
    log: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
    ...extra,
    RTCPeerConnection: class extends FakePC {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        pcs.push(this);
      }
    } as unknown as typeof RTCPeerConnection,
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
  sent?: { bytesSent: number; timestamp: number; [stat: string]: number | string | boolean },
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
  /**
   * Ana shares a 1080p60 screen to bo and cy, all connected, with 8 Mbps to spend: 4 each, so that
   * each starts at 1080p30 (3 Mbps), the highest step that fits.
   */
  async function sharing() {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, 8_000_000);
    const bo = page("bo", network);
    const cy = page("cy", network);
    const room = [{ userId: "ana" }, { userId: "bo" }, { userId: "cy" }];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
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

  it("starts each viewer's share at the highest step its share fits, scaled from the capture", async () => {
    const { ana, toBo, toCy } = await sharing();
    for (const t of [toBo, toCy]) {
      expect(t.sender.getParameters().encodings?.[0]).toMatchObject({
        maxBitrate: 3_000_000,
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
      maxBitrate: 2_080_000,
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
    expect(toBo.sender.getParameters().degradationPreference).toBe("maintain-resolution");
    ana.mesh.close();
  });

  it("reaches 1080p60 on a fast link and goes no higher, and a new share starts over", async () => {
    const { ana, toBo } = await sharing();
    toBo.sender.stats = senderStats(0);
    for (let i = 0; i < 2 + UP_SAMPLES * 3; i++) await ana.mesh.adjust();
    expect(rungs(ana.mesh)[0]).toBe("1080p60");
    expect(toBo.sender.getParameters().encodings?.[0]).toMatchObject({ maxFramerate: 60 });

    // A window of 720p30 is a share of its own: it starts over on its own steps (only 720p30).
    ana.mesh.setLocalTracks({
      screen: trackWith("ana screen 2", { width: 1280, height: 720, frameRate: 30 }, "text"),
    });
    await settle();
    expect(rungs(ana.mesh)[0]).toBe("720p30");
    ana.mesh.close();
  });

  it("builds an ultrawide's steps from its own capture, instead of pinning it to 720p", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    // 3440x1440 at 60 fps in a code room: 2968x1242 at most, frame rate dropped before size.
    const screen = trackWith("ultrawide", { width: 3440, height: 1440, frameRate: 60 }, "text");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, bo);
    await settle();
    const to = carrying(ana.pcs[0], screen) as FakeTransceiver;
    // One viewer is entitled to the whole 23 Mbps: it starts at the top of its own steps, in the
    // capture's shape, scaled down from 1440 lines (10.67 Mbps for 2968x1242 at 60 fps).
    expect(rungs(ana.mesh)).toEqual(["2968×1242@60"]);
    expect(to.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 10_670_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1440 / 1242,
    });
    // Pressure drops frames before size: 2968x1242 at 30 fps (5.33 Mbps), and so on down.
    to.sender.stats = senderStats(0.1);
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    expect(rungs(ana.mesh)).toEqual(["2968×1242@30"]);
    expect(to.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 5_330_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1440 / 1242,
    });
    ana.mesh.close();
  });

  it("gives a motion room steps that shrink before they lose frames", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const screen = trackWith("game", { width: 1920, height: 1080, frameRate: 60 }, "motion");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, bo);
    await settle();
    const to = carrying(ana.pcs[0], screen) as FakeTransceiver;
    expect(rungs(ana.mesh)).toEqual(["1080p60"]);
    // Pressure shrinks it at 60 fps, and only at the smallest size goes to 30: the floor.
    to.sender.stats = senderStats(0.1);
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 2; i++) await ana.mesh.adjust();
    for (let step = 0; step < 3; step++) {
      for (let i = 0; i < 2; i++) await ana.mesh.adjust();
      seen.push(rungs(ana.mesh)[0]);
    }
    expect(seen).toEqual(["900p60", "720p60", "720p30"]);
    expect(to.sender.getParameters().encodings?.[0]).toMatchObject({
      maxBitrate: 1_330_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1.5,
    });
    ana.mesh.close();
  });

  it("keeps a share's size when its frame rate flips, and ignores a rate that dithers", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    // A game at 1080p whose capture reports 30 fps: steps of 720p30, 900p30 and 1080p30.
    const capture = { width: 1920, height: 1080, frameRate: 30 };
    const screen = trackWith("game", capture, "motion");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, bo);
    await settle();
    expect(rungs(ana.mesh)).toEqual(["1080p30"]);
    // It starts reporting 60: the steps are built again and the share stays at 1080 lines, at the
    // frame rate it can now have, not at the 720p60 that costs no more than 1080p30 did.
    capture.frameRate = 60;
    await ana.mesh.adjust();
    expect(rungs(ana.mesh)).toEqual(["1080p60"]);
    // Dithering around 60 changes nothing, and neither does a flip back and forth:
    // 1080p60 -> 1080p30 -> 1080p60 keeps the size.
    for (const frameRate of [58, 59.9, 55, 58]) {
      capture.frameRate = frameRate;
      await ana.mesh.adjust();
      expect(rungs(ana.mesh)).toEqual(["1080p60"]);
    }
    for (const frameRate of [30, 60, 30, 60]) {
      capture.frameRate = frameRate;
      await ana.mesh.adjust();
      expect(rungs(ana.mesh)[0]).toMatch(/^1080p/);
    }
    ana.mesh.close();
  });

  it("caps a camera at what its capture feeds", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    // A 240-line camera has nothing for the 360p rung's 500 kbps to carry.
    const cam = trackWith("cam", { width: 426, height: 240, frameRate: 15 });
    ana.mesh.setLocalTracks({ cam });
    await settle();
    connect(ana, bo);
    await settle();
    const to = carrying(ana.pcs[0], cam) as FakeTransceiver;
    expect(ana.mesh.quality()[0]).toMatchObject({ cam: { rung: "180p15" } });
    expect(to.sender.getParameters().encodings?.[0]).toMatchObject({ maxBitrate: 150_000 });
    to.sender.stats = senderStats(0);
    for (let i = 0; i < 2 + UP_SAMPLES * 2; i++) await ana.mesh.adjust();
    expect(ana.mesh.quality()[0]).toMatchObject({ cam: { rung: "180p15" } });
    ana.mesh.close();
  });

  it("caps a share at what its capture feeds, and drops the camera to 180p under pressure", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const screen = trackWith("small window", { width: 1280, height: 720, frameRate: 30 });
    const cam = trackWith("cam", { width: 640, height: 360, frameRate: 15 });
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
    // That first pass never ends (bo's read hangs), but cy's own read does: let it, so the next
    // pass doesn't find cy still busy and skip it, however many ticks a read takes.
    await settle();
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
    ana.mesh.setLocalTracks({
      screen: trackWith("s", { width: 1920, height: 1080, frameRate: 60 }),
    });
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

describe("Mesh quality telemetry (ADR 2 addendum)", () => {
  /** Ana shares a 1080p60 screen to bo, both reporting rows over 24 s windows, all connected. */
  async function watched(start?: StartOrder, sentCodec = "video/VP9") {
    const network = new Map<string, Mesh>();
    const rows = { ana: [] as PendingSample[], bo: [] as PendingSample[] };
    const options = (who: keyof typeof rows) => ({
      onQuality: (row: PendingSample) => rows[who].push(row),
      sampleWindowMs: 24_000,
    });
    const ana = page("ana", network, undefined, undefined, 4_000_000, options("ana"));
    if (start) ana.mesh.setStartOrder("screen", start);
    const bo = page("bo", network, undefined, undefined, undefined, options("bo"));
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, bo);
    await settle();
    const toBo = carrying(ana.pcs[0], screen) as FakeTransceiver;
    const shown = bo.mesh.peers()[0]?.tracks.screen;
    const fromAna = bo.pcs[0]?.getReceivers().find((r) => r.track === shown);
    if (!fromAna) throw new Error("bo is not receiving ana's screen");
    let seconds = 0;
    /** One pass on both pages, `loss` on ana's link, with steady counters (2 Mbps, QP 40). */
    const pass = async (loss = 0) => {
      seconds += 4;
      const frames = seconds * 30;
      toBo.sender.stats = senderStats(loss, sentCodec, {
        bytesSent: seconds * 250_000,
        timestamp: seconds * 1_000,
        framesEncoded: frames,
        qpSum: frames * 40,
        targetBitrate: 2_400_000,
        // 4 ms of encoding a frame, on the software encoder Chromium names while capturing.
        totalEncodeTime: frames * 0.004,
        encoderImplementation: "libvpx",
        powerEfficientEncoder: false,
      });
      fromAna.stats = new Map<string, unknown>([
        [
          "i",
          {
            id: "i",
            type: "inbound-rtp",
            kind: "video",
            timestamp: seconds * 1_000,
            bytesReceived: seconds * 240_000,
            framesDecoded: frames,
            qpSum: frames * 42,
            freezeCount: seconds / 4,
            frameWidth: 1920,
            frameHeight: 1080,
          },
        ],
      ]);
      await ana.mesh.adjust();
      await bo.mesh.adjust();
    };
    return { ana, bo, rows, pass };
  }

  it("reports a row for the video it sends and one for what the other end receives, per window", async () => {
    const { ana, bo, rows, pass } = await watched();
    for (let i = 0; i < 6; i++) await pass();
    expect(rows).toEqual({ ana: [], bo: [] });
    await pass();
    expect(rows.ana.map((r) => [r.trigger, r.windowMs, r.toRung, r.reason])).toEqual([
      ["window", 24_000, null, null],
    ]);
    // The next pass completes a clean spell and probes up past the viewer's 4 Mbps share (the
    // budget grows for it): a row of its own, ending the 4 s since the last window.
    await pass();
    expect(rows.ana.map((r) => [r.trigger, r.windowMs, r.toRung, r.reason])).toEqual([
      ["window", 24_000, null, null],
      ["rung", 4_000, "1080p60", "probe"],
    ]);
    expect(rows.ana[0]).toMatchObject({
      peerId: "bo",
      slot: "screen",
      direction: "send",
      trigger: "window",
      windowMs: 24_000,
      rung: "1080p30",
      maxBitrate: 3_000_000,
      targetBitrate: 2_400_000,
      bitrate: 2_000_000,
      qp: 40,
      codec: "video/VP9",
      // Until the codec picks land, every sender is on its codec by the normal order.
      codecReason: "preferred",
      fromCodec: null,
      encoderImplementation: "libvpx",
      powerEfficientEncoder: false,
      encodeMs: 4,
    });
    // What bo receives: no rung (it can't tell), QP and size from its own decoder, and the freezes.
    expect(rows.bo).toHaveLength(1);
    expect(rows.bo[0]).toMatchObject({
      peerId: "ana",
      slot: "screen",
      direction: "recv",
      trigger: "window",
      windowMs: 24_000,
      rung: null,
      maxBitrate: null,
      targetBitrate: null,
      bitrate: 1_920_000,
      qp: 42,
      frameWidth: 1920,
      frameHeight: 1080,
      freezes: 6,
      codecReason: null,
      encoderImplementation: null,
      powerEfficientEncoder: null,
      encodeMs: null,
    });
    ana.mesh.close();
    bo.mesh.close();
  });

  it("says in the send rows why the sender is on its codec, while it sends the codec that reason is about", async () => {
    for (const [start, sent, reason] of [
      [undefined, "video/VP9", "preferred"],
      [NORMAL_START, "video/AV1", "preferred"],
      [HARDWARE_VP9_START, "video/VP9", "hardware"],
      // A viewer without VP9 leaves the sender on AV1.
      [HARDWARE_VP9_START, "video/AV1", "preferred"],
      [HARDWARE_H264_START, "video/H264", "hardware"],
      // A viewer without H.264 leaves the sender on AV1.
      [HARDWARE_H264_START, "video/AV1", "preferred"],
      [FIREFOX_START, "video/H264", "browser"],
      [FIREFOX_START, "video/VP8", "browser"],
    ] as const) {
      const { ana, bo, rows, pass } = await watched(start, sent);
      for (let i = 0; i < 7; i++) await pass();
      expect(rows.ana[0]).toMatchObject({ direction: "send", codec: sent, codecReason: reason });
      expect(rows.bo[0]).toMatchObject({ direction: "recv", codecReason: null });
      ana.mesh.close();
      bo.mesh.close();
    }
  });

  it("stops reporting what bo receives once the server says ana no longer shares it", async () => {
    const { ana, bo, rows, pass } = await watched();
    for (let i = 0; i < 3; i++) await pass();
    expect(rows.bo).toEqual([]);
    // The roster says ana's share is off. What bo had received goes out once, as a last row,
    // and no more follows although the stats keep being read (bo's receiver keeps its track).
    bo.mesh.join([
      { userId: "ana", media: { cam: false, share: false } },
      { userId: "bo", media: { cam: false, share: false } },
    ]);
    expect(rows.bo.map((r) => [r.peerId, r.slot, r.direction, r.windowMs])).toEqual([
      ["ana", "screen", "recv", 8_000],
    ]);
    for (let i = 0; i < 20; i++) await pass();
    expect(rows.bo).toHaveLength(1);
    // Ana's own page goes on reporting what she sends bo.
    expect(rows.ana.length).toBeGreaterThan(0);
    ana.mesh.close();
    bo.mesh.close();
  });

  it("stays quiet about an ended share through a reconnect", async () => {
    const { ana, bo, rows, pass } = await watched();
    for (let i = 0; i < 3; i++) await pass();
    bo.mesh.join([
      { userId: "ana", media: { cam: false, share: false } },
      { userId: "bo", media: { cam: false, share: false } },
    ]);
    expect(rows.bo).toHaveLength(1);
    // The link drops and comes back (no `join` after it): the share is still known to be over.
    bo.pcs[0]?.setConnectionState("failed");
    await pass();
    await pass();
    connect(bo);
    for (let i = 0; i < 20; i++) await pass();
    expect(rows.bo).toHaveLength(1);
    ana.mesh.close();
    bo.mesh.close();
  });

  it("stops reporting a camera this page hides, and starts afresh when it is shown again", async () => {
    const { ana, bo, rows, pass } = await watched();
    const roster = [
      { userId: "ana", media: { cam: true, share: true } },
      { userId: "bo", media: { cam: false, share: false } },
    ];
    bo.mesh.join(roster);
    ana.mesh.setLocalTracks({ cam: track("ana cam") });
    await settle();
    const shown = bo.mesh.peers()[0]?.tracks.cam;
    const fromAna = bo.pcs[0]?.getReceivers().find((r) => r.track === shown);
    if (!fromAna) throw new Error("bo is not receiving ana's camera");
    let seconds = 0;
    /** A pass with the camera's counters growing (or standing still). */
    const camPass = async (growing: boolean) => {
      seconds += 4;
      const t = growing ? seconds : 12;
      fromAna.stats = new Map<string, unknown>([
        [
          "i",
          {
            id: "i",
            type: "inbound-rtp",
            kind: "video",
            timestamp: seconds * 1_000,
            bytesReceived: t * 240_000,
            framesDecoded: t * 30,
          },
        ],
      ]);
      await pass();
    };
    const camRows = () => rows.bo.filter((r) => r.slot === "cam");
    for (let i = 0; i < 3; i++) await camPass(true);
    expect(camRows()).toEqual([]);
    // Hidden: it is paused towards bo, so what it had received goes out once and no stall follows.
    bo.mesh.setVisible("ana", "cam", false);
    expect(camRows().map((r) => r.windowMs)).toEqual([8_000]);
    for (let i = 0; i < 12; i++) await camPass(false);
    expect(camRows()).toHaveLength(1);
    // Shown again: a new stream, which a standing counter doesn't make a stall of.
    bo.mesh.setVisible("ana", "cam", true);
    for (let i = 0; i < 8; i++) await camPass(false);
    expect(camRows()).toHaveLength(1);
    // Until it delivers: then it reports a window of its own.
    for (let i = 0; i < 8; i++) await camPass(true);
    expect(camRows().map((r) => [r.direction, r.bitrate !== 0])).toEqual([
      ["recv", true],
      ["recv", true],
    ]);
    // The roster saying the camera is off ends it as well, shown or not.
    bo.mesh.join([{ userId: "ana", media: { cam: false, share: true } }, { userId: "bo" }]);
    for (let i = 0; i < 12; i++) await camPass(false);
    expect(camRows()).toHaveLength(3);
    ana.mesh.close();
    bo.mesh.close();
  });

  it("reports a rung change at once, ending the window with where from, to and why", async () => {
    const { ana, bo, rows, pass } = await watched();
    // The first readings of a sender are warm-up; then two lossy passes in a row step it down.
    for (let i = 0; i < 3; i++) await pass();
    await pass(0.1);
    expect(rows.ana).toEqual([]);
    await pass(0.1);
    expect(rows.ana).toHaveLength(1);
    expect(rows.ana[0]).toMatchObject({
      trigger: "rung",
      direction: "send",
      rung: "1080p30",
      toRung: "900p30",
      reason: "pressure",
      windowMs: 16_000,
      maxBitrate: 3_000_000,
    });
    // bo can't tell the sender changed rung: its windows go on as before.
    expect(rows.bo).toEqual([]);
    for (let i = 0; i < 2; i++) await pass();
    expect(rows.bo.map((r) => [r.trigger, r.windowMs])).toEqual([["window", 24_000]]);
    ana.mesh.close();
    bo.mesh.close();
  });
});

describe("Mesh uplink budget (ADR 2)", () => {
  const MBPS = 1_000_000;

  /**
   * Ana shares a 1080p60 screen (and, with `withCam`, a 360p15 camera) to `names` (all
   * connected), with `uplink` bits per second to spend.
   */
  async function crowd(
    names: string[],
    uplink?: number,
    withCam = false,
    capture: MediaTrackSettings = { width: 1920, height: 1080, frameRate: 60 },
    hint = "text",
    extra: Partial<MeshOptions> = {},
  ) {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, uplink, extra);
    const viewers = names.map((name) => page(name, network));
    const room = [{ userId: "ana" }, ...names.map((userId) => ({ userId }))];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    const screen = trackWith("ana screen", capture, hint);
    const cam = trackWith("ana cam", { width: 640, height: 360, frameRate: 15 });
    ana.mesh.setLocalTracks(withCam ? { screen, cam } : { screen });
    await settle();
    connect(ana, ...viewers);
    await settle();
    // Ana's connections are in the order of `names`.
    const senders = ana.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    return { ana: ana.mesh, anaPage: ana, network, viewers, senders, screen };
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

  it("starts many viewers at an equal share of the budget instead of every one at the top", async () => {
    // Five viewers share 13.5 Mbps: 2.7 each, so 900p30 (2.08) is the step that fits.
    const five = await crowd(["bo", "cy", "di", "ed", "fi"], 13.5 * MBPS);
    expect(five.ana.uplink()).toEqual({ budget: 13.5 * MBPS, targeted: 10.4 * MBPS });
    expect(labels(five.ana)).toEqual(Array(5).fill("900p30"));
    five.ana.close();

    // A crowd that can't afford even that starts at the lowest step: 1.69 each for eight.
    const eight = await crowd(["bo", "cy", "di", "ed", "fi", "gu", "hu", "io"], 13.5 * MBPS);
    expect(labels(eight.ana)).toEqual(Array(8).fill("720p30"));
    expect((await pass(eight.ana, eight.senders)).targeted).toBeLessThanOrEqual(13.5 * MBPS);
    eight.ana.close();

    // With the default budget, nine viewers (ADR 2's worst case, 27 Mbps at 1080p30) fit too.
    const nine = await crowd(["bo", "cy", "di", "ed", "fi", "gu", "hu", "io", "jo"]);
    const { budget, targeted } = await pass(nine.ana, nine.senders);
    expect(targeted).toBeLessThanOrEqual(budget);
    expect(labels(nine.ana)).toEqual(Array(9).fill("900p30"));
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
    // The codec switch answers a CPU limit first (the fake pairs have no H.264 to go to, so none
    // moves, but the switch is spent): the steps hold back until it has fired...
    await pass(ana, senders, { limit: "cpu" });
    await pass(ana, senders, { limit: "cpu" });
    expect(labels(ana)).toEqual(Array(6).fill("1080p30"));
    // ...and then each pair steps down for it.
    await pass(ana, senders, { limit: "cpu" });
    const { budget } = await pass(ana, senders, { limit: "cpu" });
    expect(budget).toBe(30 * MBPS);
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
    expect(await pass(ana, senders)).toEqual({ budget: 15 * MBPS, targeted: 15 * MBPS });
    expect(count(labels(ana), "1080p60")).toBe(1);
    expect(count(labels(ana), "1080p30")).toBe(3);
    // And so on, never past the budget at any pass.
    for (let i = 0; i < 40; i++) {
      const { budget, targeted } = await pass(ana, senders);
      expect(targeted).toBeLessThanOrEqual(budget);
    }
    expect(ana.uplink().budget).toBeGreaterThan(15 * MBPS);
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
    // Ed's link loses 2%: not strained, not clean. He never probes, and never holds the turn.
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed"], 12 * MBPS);
    expect(labels(ana)).toEqual(Array(4).fill("1080p30"));
    const options = { loss: (i: number) => (i === 3 ? 0.02 : 0) };
    for (let i = 0; i < 2 + UP_SAMPLES; i++) await pass(ana, senders, options);
    expect(await pass(ana, senders, options)).toEqual({
      budget: 15 * MBPS,
      targeted: 15 * MBPS,
    });
    expect(count(labels(ana), "1080p60")).toBe(1);
    expect(labels(ana)[3]).toBe("1080p30");
    ana.close();
  });

  it("grows the budget for another pair when the lowest one has dropped off", async () => {
    const { ana, anaPage, senders } = await crowd(["bo", "cy", "di", "ed"], 12 * MBPS);
    // Ed's link is lossy for a while, which takes him a step down: he is the lowest rung.
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    for (let i = 0; i < 2; i++) await pass(ana, [senders[3] as FakeTransceiver], { loss: 0.1 });
    expect(labels(ana)[3]).toBe("900p30");
    // Then his connection drops, so the others take the turn: one probes, the budget grows.
    anaPage.pcs[3]?.setConnectionState("disconnected");
    for (let i = 0; i < UP_SAMPLES + 1; i++) await pass(ana, senders.slice(0, 3));
    expect(count(labels(ana), "1080p60")).toBe(1);
    expect(labels(ana)[3]).toBe("900p30");
    expect(ana.uplink().budget).toBeGreaterThan(12 * MBPS);
    ana.close();
  });

  it("brings a resumed camera back through the budget, so nobody else steps down", async () => {
    const { ana, anaPage, network, viewers } = await crowd(["bo", "cy", "di"], 12.9 * MBPS, true);
    expect(ana.uplink().targeted).toBe(10.5 * MBPS);
    const [bo] = viewers;
    bo?.mesh.setVisible("ana", "cam", false);
    await settle();
    expect(ana.uplink().targeted).toBe(10 * MBPS);
    // Meanwhile a newcomer takes what room there is: a 900p30 share (its fair share) and a 360p15 camera.
    const ed = page("ed", network);
    const room = ["ana", "bo", "cy", "di", "ed"].map((userId) => ({ userId }));
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    connect(anaPage, ed);
    await settle();
    expect(ana.uplink().targeted).toBe(12.58 * MBPS);
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

  it("gives a link-limited viewer's unused share to the other viewers' probes", async () => {
    // Three viewers share 14 Mbps (4.67 each). Past 1080p30 (3 Mbps), 1080p60 costs 6 Mbps.
    const grown = await crowd(["bo", "cy", "di"], 14 * MBPS);
    for (let i = 0; i < 2 + UP_SAMPLES; i++) await pass(grown.ana, grown.senders);
    // All clean: the first to probe goes past its share, so the budget has to grow for it.
    const open = await pass(grown.ana, grown.senders);
    expect(open.budget).toBeGreaterThan(14 * MBPS);
    expect(count(labels(grown.ana), "1080p60")).toBe(1);
    grown.ana.close();

    // Di's link can't carry more than 720p30 (1.33 Mbps): the other two share the other 12.67.
    const { ana, senders } = await crowd(["bo", "cy", "di"], 14 * MBPS);
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    const lossy = { loss: (i: number) => (i === 2 ? 0.1 : 0) };
    for (let i = 0; i < 4; i++) await pass(ana, senders, lossy);
    expect(labels(ana)).toEqual(["1080p30", "1080p30", "720p30"]);
    // Bo and cy are clean for a window: both climb into di's share, with the budget as it was.
    for (let i = 0; i < UP_SAMPLES - 2; i++) await pass(ana, senders, lossy);
    const { budget, targeted } = await pass(ana, senders, lossy);
    expect(budget).toBe(14 * MBPS);
    expect(labels(ana)).toEqual(["1080p60", "1080p60", "720p30"]);
    expect(targeted).toBeCloseTo((6 + 6 + 1.33) * MBPS, -4);
    ana.close();
  });

  it("gives a viewer that joins late its share: pairs over theirs step down, the budget doesn't grow", async () => {
    // An ultrawide share to two viewers on 23 Mbps: each is entitled to 11.5, so both climb to
    // the top step, 2968x1242 at 60 fps (10.67 Mbps), 21.33 in all.
    const top = "2968×1242@60";
    const wide = { width: 3440, height: 1440, frameRate: 60 };
    const { ana, anaPage, network, screen } = await crowd(["bo", "cy"], 23 * MBPS, false, wide);
    expect(labels(ana)).toEqual([top, top]);
    // A third viewer joins and finds 1.67 Mbps of room: the floor, 1484x622 at 30 fps (1.34). Its
    // share is 7.67 Mbps, and its probes within it must go ahead although the other two sit above
    // theirs: they are the ones to give way, not the budget to grow.
    const di = page("di", network);
    const everybody = ["ana", "bo", "cy", "di"].map((userId) => ({ userId }));
    for (const mesh of network.values()) mesh.join(everybody);
    await settle();
    connect(anaPage, di);
    await settle();
    expect(labels(ana)).toEqual([top, top, "1484×622@30"]);
    const senders = anaPage.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    // Warm-up, then a clean window: it probes up to 2.08 Mbps, which the 21.33 already targeted
    // leaves no room for.
    for (let i = 0; i < 2 + UP_SAMPLES + 1; i++) await pass(ana, senders);
    expect(labels(ana)[2]).toBe("1856×776@30");
    const { budget, targeted } = ana.uplink();
    expect(budget).toBe(23 * MBPS);
    expect(targeted).toBeLessThanOrEqual(budget);
    // A pair that sat above its share came down for it (the other still sits above its own).
    expect(count(labels(ana), top)).toBe(1);
    ana.close();
  });

  it("keeps the share of a viewer whose screen hasn't started, for the others' probes", async () => {
    // Di is in the room but never answers: no screen goes to him yet. Bo and cy are entitled to a
    // third of 12 Mbps each, so they start at 1080p30 (3 Mbps), not 1080p60 (6) as they would
    // with the room to themselves.
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, 12 * MBPS);
    const viewers = ["bo", "cy"].map((name) => page(name, network));
    const room = ["ana", "bo", "cy", "di"].map((userId) => ({ userId }));
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, ...viewers);
    await settle();
    const senders = ana.pcs.slice(0, 2).map((pc) => carrying(pc, screen) as FakeTransceiver);
    expect(labels(ana.mesh)).toEqual(["1080p30", "1080p30", undefined]);
    // A clean window later, a probe to 1080p60 takes more than their share: it needs the budget
    // to grow, since di's share is spoken for, though the budget has 6 Mbps unused.
    for (let i = 0; i < 2 + UP_SAMPLES + 1; i++) await pass(ana.mesh, senders);
    expect(ana.mesh.uplink().budget).toBeGreaterThan(12 * MBPS);
    ana.mesh.close();
  });

  it("doesn't probe and shed in turns when one of the viewers has failed", async () => {
    // A motion room, 9 Mbps, three viewers: 3 each, so each starts at 720p60 (2.67). Di's link
    // fails; his sender keeps its track until a retry, though nothing flows to him. Bo and cy
    // are then entitled to 4.5 each. Counting di's target in the budget while leaving him out of
    // the shares let an entitled probe overshoot the budget and be shed in the same pass: the
    // two went up and down at every window, for ever.
    const rows: PendingSample[] = [];
    const wide = { width: 1920, height: 1080, frameRate: 60 };
    const { ana, anaPage, senders } = await crowd(
      ["bo", "cy", "di"],
      9 * MBPS,
      false,
      wide,
      "motion",
      {
        onQuality: (row) => rows.push(row),
        sampleWindowMs: 24_000,
      },
    );
    for (let i = 0; i < 2; i++) {
      anaPage.pcs[2]?.setConnectionState("failed");
      await settle();
    }
    for (let i = 0; i < 100; i++) await pass(ana, senders);
    const settled = rows.length;
    for (let i = 0; i < 100; i++) await pass(ana, senders);
    const changes = rows.slice(settled).filter((row) => row.trigger === "rung");
    expect(changes.map((row) => `${row.rung} -> ${row.toRung} (${row.reason})`)).toEqual([]);
    expect(ana.uplink().targeted).toBeLessThanOrEqual(ana.uplink().budget);
    ana.close();
  });

  it("doesn't wait on a pair that has dropped off to take its turn", async () => {
    // Four viewers on 8 Mbps: 2 each, so all start at 720p30 (1.33), and they climb a step at a
    // time, the lowest due pair first. Take the moment when only ed is still on 720p30: he is
    // due to probe, and the others (due for 1080p30, past their share) wait their turn behind him.
    const { ana, anaPage, senders } = await crowd(["bo", "cy", "di", "ed"], 8 * MBPS);
    let passes = 0;
    while (labels(ana).slice(0, 3).includes("720p30") || labels(ana)[3] !== "720p30") {
      if (++passes > 200) throw new Error(`never reached the state: ${labels(ana).join(" ")}`);
      await pass(ana, senders);
    }
    expect(labels(ana)).toEqual(["900p30", "900p30", "900p30", "720p30"]);
    // He drops off. A pair that isn't connected never probes, so he must not hold the turn.
    anaPage.pcs[3]?.setConnectionState("disconnected");
    for (let i = 0; i < 4 * UP_SAMPLES; i++) await pass(ana, senders.slice(0, 3));
    expect(labels(ana).slice(0, 3)).toContain("1080p30");
    ana.close();
  });

  it("steps a camera down to 180p before it steps any screen down", async () => {
    // Four viewers, each with a 1080p30 share and a 360p15 camera: 14 Mbps of a 16 Mbps budget.
    const { ana, senders } = await crowd(["bo", "cy", "di", "ed"], 16 * MBPS, true);
    expect(ana.uplink()).toEqual({ budget: 16 * MBPS, targeted: 14 * MBPS });
    for (let i = 0; i < 2; i++) await pass(ana, senders);
    // Two of the four pairs are strained: the uplink is short, and the budget drops (by 30%).
    const strained = { loss: (i: number) => (i < 2 ? 0.1 : 0), share: 0.5 };
    await pass(ana, senders, strained);
    const { budget, targeted } = await pass(ana, senders, strained);
    expect(budget).toBeCloseTo(16 * MBPS * UPLINK_DROP_LIMIT, -3);
    expect(targeted).toBeLessThanOrEqual(budget);
    // The two strained screens stepped down on their own. The two healthy ones, the heaviest
    // senders, are still at 1080p30: it was the cameras that gave way.
    expect(labels(ana)).toEqual(["900p30", "900p30", "1080p30", "1080p30"]);
    const cameras = ana.quality().map((q) => q.cam?.rung);
    expect(count(cameras, "180p15")).toBeGreaterThanOrEqual(3);
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
        screen: trackWith("ana screen 2", { width: 1920, height: 1080, frameRate: 60 }, "motion"),
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

describe("Mesh: caps by codec (ADR 2 addendum)", () => {
  const MBPS = 1_000_000;
  const H264 = "video/H264";
  const encoding = (t: FakeTransceiver) => t.sender.getParameters().encodings?.[0];

  /**
   * Ana shares a 1080p60 screen (text room: 720p30, 900p30, 1080p30 at 3 Mbps, 1080p60 at 6) to
   * `names`, all connected, with `uplink` to spend. Ana's connections are in the order of `names`.
   */
  async function sharing(names: string[], uplink: number, extra: Partial<MeshOptions> = {}) {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, uplink, extra);
    const viewers = names.map((name) => page(name, network));
    for (const mesh of network.values()) {
      mesh.join([{ userId: "ana" }, ...names.map((userId) => ({ userId }))]);
    }
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, ...viewers);
    await settle();
    const to = ana.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    return { ana, viewers, to };
  }
  const notes = (sent: SignalPayload[]) =>
    sent.filter((p): p is Extract<SignalPayload, { kind: "quality" }> => p.kind === "quality");

  it("applies 1.5x the step's cap to a pair sending H.264, and leaves one on VP9", async () => {
    // 8 Mbps over two viewers: 1080p30 each, 3 Mbps on a codec that is not known yet.
    const { ana, to } = await sharing(["bo", "cy"], 8 * MBPS);
    const [toBo, toCy] = to as [FakeTransceiver, FakeTransceiver];
    expect(encoding(toBo)?.maxBitrate).toBe(3 * MBPS);
    toBo.sender.stats = senderStats(0, H264);
    toCy.sender.stats = senderStats(0, "video/VP9");
    await ana.mesh.adjust();
    await settle();
    expect(encoding(toBo)).toMatchObject({ maxBitrate: 4.5 * MBPS, maxFramerate: 30 });
    expect(encoding(toCy)).toMatchObject({ maxBitrate: 3 * MBPS, maxFramerate: 30 });
    // The labels are the steps' own, and the budget's targets add up the scaled caps.
    expect(ana.mesh.quality().map((q) => q.screen)).toEqual([
      { rung: "1080p30", codec: H264 },
      { rung: "1080p30", codec: "video/VP9" },
    ]);
    expect(ana.mesh.uplink()).toEqual({ budget: 8 * MBPS, targeted: 7.5 * MBPS });
    // The viewer is told the scaled cap with the same step.
    expect(notes(ana.sent).map((n) => [n.step, n.maxBitrate])).toEqual([
      ["1080p30", 3 * MBPS],
      ["1080p30", 3 * MBPS],
      ["1080p30", 4.5 * MBPS],
    ]);
    ana.mesh.close();
  });

  it("takes no codec from the parameters while a remote offer is applied and not yet answered", async () => {
    // One viewer is entitled to all 8 Mbps: it starts at 1080p60 (6 Mbps) on a codec not known yet.
    const { ana, to } = await sharing(["bo"], 8 * MBPS);
    const [toBo] = to as [FakeTransceiver];
    expect(ana.mesh.quality()[0]?.screen?.rung).toBe("1080p60");
    // Until the answer is set the parameters list the browser's capabilities, VP8 first: not
    // what will be sent, so they must not scale the cap or start the step again (VP8's 1.5x
    // would refit 1080p60 to 1080p30).
    toBo.sender.codecs = [{ mimeType: "video/VP8" }, { mimeType: "video/VP9" }];
    (ana.pcs[0] as FakePC).signalingState = "have-remote-offer";
    await ana.mesh.adjust();
    await settle();
    expect(ana.mesh.quality()[0]?.screen).toEqual({ rung: "1080p60" });
    expect(encoding(toBo)?.maxBitrate).toBe(6 * MBPS);
    ana.mesh.close();
  });

  it("scales VP8 too, and neither AV1 nor an unknown codec", async () => {
    const { ana, to } = await sharing(["bo", "cy", "di"], 12 * MBPS);
    const codecs = ["video/VP8", "video/AV1", "video/H265"];
    to.forEach((t, i) => {
      t.sender.stats = senderStats(0, codecs[i]);
    });
    await ana.mesh.adjust();
    await settle();
    expect(to.map((t) => encoding(t)?.maxBitrate)).toEqual([4.5 * MBPS, 3 * MBPS, 3 * MBPS]);
    ana.mesh.close();
  });

  it("re-applies the cap when the codec changes, and again when it changes back", async () => {
    const { ana, to } = await sharing(["bo"], 12 * MBPS);
    const [toBo] = to as [FakeTransceiver];
    toBo.sender.stats = senderStats(0, "video/VP9");
    await ana.mesh.adjust();
    await settle();
    const rung = ana.mesh.quality()[0]?.screen?.rung;
    expect(encoding(toBo)?.maxBitrate).toBe(rungCap(rung));
    const calls = toBo.sender.setCalls;

    // The codec changes, the step does not: the next pass applies the scaled cap.
    toBo.sender.stats = senderStats(0, H264);
    await ana.mesh.adjust();
    await settle();
    expect(ana.mesh.quality()[0]?.screen?.rung).toBe(rung);
    expect(encoding(toBo)?.maxBitrate).toBe((rungCap(rung) as number) * 1.5);
    expect(toBo.sender.setCalls).toBe(calls + 1);

    // Nothing changed since: nothing is applied again.
    await ana.mesh.adjust();
    await settle();
    expect(toBo.sender.setCalls).toBe(calls + 1);

    toBo.sender.stats = senderStats(0, "video/AV1");
    await ana.mesh.adjust();
    await settle();
    expect(encoding(toBo)?.maxBitrate).toBe(rungCap(rung));
    expect(toBo.sender.setCalls).toBe(calls + 2);
    ana.mesh.close();
  });

  it("steps a pair down to fit the budget when its codec turns out to be H.264", async () => {
    // 7 Mbps over two viewers: 3.5 each, so 1080p30 (3 Mbps) each: 6 Mbps in all.
    const { ana, to } = await sharing(["bo", "cy"], 7 * MBPS);
    const [toBo, toCy] = to as [FakeTransceiver, FakeTransceiver];
    expect(ana.mesh.uplink()).toEqual({ budget: 7 * MBPS, targeted: 6 * MBPS });
    toBo.sender.stats = senderStats(0, H264);
    toCy.sender.stats = senderStats(0, "video/VP9");
    await ana.mesh.adjust();
    await settle();
    // bo's 1080p30 now costs 4.5 and takes more than its 3.5 share: it, and not cy, gives way, to
    // 900p30 at 2.08 x 1.5 Mbps.
    expect(ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["900p30", "1080p30"]);
    expect(encoding(toBo)?.maxBitrate).toBe(3.12 * MBPS);
    expect(encoding(toCy)?.maxBitrate).toBe(3 * MBPS);
    expect(ana.mesh.uplink()).toEqual({ budget: 7 * MBPS, targeted: 6.12 * MBPS });
    ana.mesh.close();
  });

  it("steps down under pressure to what the estimate carries at the scaled caps", async () => {
    const { ana, to } = await sharing(["bo"], 20 * MBPS);
    const [toBo] = to as [FakeTransceiver];
    expect(ana.mesh.quality()[0]?.screen?.rung).toBe("1080p60");
    // Loss, with a 4 Mbps estimate: a step down lands where the scaled cap fits it.
    const lossy = (estimate: number) => {
      const stats = senderStats(0.1, H264);
      stats.set("p", { id: "p", type: "candidate-pair", availableOutgoingBitrate: estimate });
      return stats;
    };
    toBo.sender.stats = lossy(4 * MBPS);
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    // 1080p30 is 4.5 Mbps on H.264, over the estimate (3 Mbps on VP9 would fit): 900p30, 3.12.
    expect(ana.mesh.quality()[0]?.screen?.rung).toBe("900p30");
    expect(encoding(toBo)?.maxBitrate).toBe(3.12 * MBPS);
    ana.mesh.close();
  });

  it("probes on the scaled cap: an H.264 pair has to grow the budget where VP9 fits", async () => {
    const climb = async (codec: string) => {
      // One viewer is entitled to all 8 Mbps. It starts at 1080p60 on a codec not yet known.
      const { ana, to } = await sharing(["bo"], 8 * MBPS);
      const [toBo] = to as [FakeTransceiver];
      toBo.sender.stats = senderStats(0.1, codec);
      for (let i = 0; i < 4; i++) await ana.mesh.adjust();
      toBo.sender.stats = senderStats(0, codec);
      for (let i = 0; i < 20; i++) await ana.mesh.adjust();
      await settle();
      const result = {
        rung: ana.mesh.quality()[0]?.screen?.rung,
        maxBitrate: encoding(toBo)?.maxBitrate,
        budget: ana.mesh.uplink().budget,
      };
      ana.mesh.close();
      return result;
    };
    // VP9: down to 1080p30 and back up to 1080p60 (6 Mbps), within the 8 Mbps entitled.
    expect(await climb("video/VP9")).toEqual({
      rung: "1080p60",
      maxBitrate: 6 * MBPS,
      budget: 8 * MBPS,
    });
    // H.264: 1080p60 is 9 Mbps, past the 8 that it is entitled to: it goes up only by growing
    // the budget to fit the probe, on a clean spell.
    expect(await climb(H264)).toEqual({
      rung: "1080p60",
      maxBitrate: 9 * MBPS,
      budget: 9 * MBPS,
    });
  });

  it("reports the scaled cap as the telemetry's maxBitrate", async () => {
    const rows: PendingSample[] = [];
    const { ana, to } = await sharing(["bo"], 5 * MBPS, {
      onQuality: (row) => rows.push(row),
      sampleWindowMs: 24_000,
    });
    const [toBo] = to as [FakeTransceiver];
    // 5 Mbps: 1080p30 (3 Mbps), 4.5 Mbps on H.264, still within the budget.
    for (let seconds = 4; seconds <= 28; seconds += 4) {
      toBo.sender.stats = senderStats(0, H264, {
        bytesSent: seconds * 250_000,
        timestamp: seconds * 1_000,
      });
      await ana.mesh.adjust();
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "send",
      rung: "1080p30",
      maxBitrate: 4.5 * MBPS,
      codec: H264,
    });
    ana.mesh.close();
  });
});

/** The cap of a 1080p60 screen's step by label, on AV1 and VP9 (see the steps above). */
const rungCap = (label: string | undefined) =>
  ({ "720p30": 1_330_000, "900p30": 2_080_000, "1080p30": 3_000_000, "1080p60": 6_000_000 })[
    label ?? ""
  ];

describe("Mesh: the codec switch (ADR 2 addendum)", () => {
  const MBPS = 1_000_000;
  const AV1 = "video/AV1";
  const H264 = "video/H264";
  const codec = (mimeType: string, sdpFmtpLine?: string) => ({
    mimeType,
    clockRate: 90_000,
    ...(sdpFmtpLine && { sdpFmtpLine }),
  });
  const negotiated = [
    codec(AV1),
    codec("video/VP9", "profile-id=0"),
    codec(H264, "profile-level-id=42e01f"),
    codec("video/VP8"),
  ];
  const capable: VideoCodecs = {
    send: [...negotiated, codec("video/rtx")],
    receive: negotiated.map((c) => c.mimeType),
  };
  type CodecEncoding = RTCRtpEncodingParameters & { codec?: { mimeType: string } };
  const encoding = (t: FakeTransceiver) => t.sender.getParameters().encodings?.[0] as CodecEncoding;
  const codecOf = (t: FakeTransceiver) => encoding(t).codec?.mimeType;
  const prefers = (t: FakeTransceiver) => t.codecPreferences.map((c) => c.mimeType);
  const sentRows = (rows: PendingSample[]) => rows.filter((r) => r.direction === "send");

  afterEach(() => {
    browser.takesEncodingCodec = true;
    vi.useRealTimers();
  });

  /**
   * Ana shares a 1080p60 screen to `names` (and her camera, if asked), all connected, with
   * `uplink` to spend; then the clock is fake, so that the stagger between pairs can be waited
   * out. `pass` is one quality pass: every sender in `only` reads `codec` (AV1 by default) with a
   * CPU limit on the pairs `limited` says (every one by default), at four-second steps.
   */
  async function sharing(
    names: string[],
    { cam = false, uplink = 40 * MBPS, formats = negotiated } = {},
  ) {
    vi.useRealTimers();
    const network = new Map<string, Mesh>();
    const rows: PendingSample[] = [];
    const reports: ConnectionEvent[] = [];
    const ana = page("ana", network, undefined, capable, uplink, {
      onQuality: (row) => rows.push(row),
      onReport: (event) => reports.push(event),
      sampleWindowMs: 24_000,
    });
    const viewers = names.map((name) => page(name, network));
    const room = [{ userId: "ana" }, ...names.map((userId) => ({ userId }))];
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
    const camera = trackWith("ana cam", { width: 640, height: 360, frameRate: 15 });
    ana.mesh.setLocalTracks({ screen, ...(cam && { cam: camera }) });
    await settle();
    connect(ana, ...viewers);
    await settle();
    const senders = (track: MediaStreamTrack) =>
      ana.pcs.map((pc) => carrying(pc, track) as FakeTransceiver);
    const screens = senders(screen);
    const cams = cam ? senders(camera) : [];
    for (const t of [...screens, ...cams]) t.sender.codecs = formats;
    vi.useFakeTimers();
    let seconds = 0;
    const pass = async ({
      codec: sent = AV1,
      limited = (_pair: number): boolean => true,
      camLimited = undefined as ((pair: number) => boolean) | undefined,
    } = {}) => {
      seconds += 4;
      [...screens, ...cams].forEach((t, i) => {
        t.sender.stats = senderStats(
          0,
          sent,
          { bytesSent: seconds * 250_000, timestamp: seconds * 1_000, framesEncoded: seconds * 30 },
          (i < screens.length ? limited : (camLimited ?? limited))(i % names.length)
            ? "cpu"
            : "none",
        );
      });
      await ana.mesh.adjust();
      await vi.advanceTimersByTimeAsync(0);
    };
    return { ana, viewers, network, screens, cams, rows, reports, pass };
  }

  it("holds a CPU limit back from the steps until the switch, waits out the warm-up, and fires on the second pass", async () => {
    const { ana, screens, pass } = await sharing(["bo", "cy"]);
    const rung = ana.mesh.quality()[0]?.screen?.rung;
    // Two warm-up readings, then one pass with the limit on both pairs: no switch, and no step
    // down either (a second such pass would step down for a CPU limit, if it were pressure).
    for (let i = 0; i < 3; i++) await pass();
    expect(screens.map(codecOf)).toEqual([undefined, undefined]);
    expect(prefers(screens[0] as FakeTransceiver)[0]).toBe(AV1);
    expect(ana.mesh.quality().map((q) => q.screen?.rung)).toEqual([rung, rung]);
    await pass();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screens.map(codecOf)).toEqual([H264, H264]);
    expect(ana.mesh.quality().map((q) => q.screen?.rung)).toEqual([rung, rung]);
    ana.mesh.close();
  });

  it("does not hold back strain: loss still steps down, switch or not", async () => {
    const { ana, screens } = await sharing(["bo"]);
    const rung = ana.mesh.quality()[0]?.screen?.rung;
    for (let i = 1; i <= 6; i++) {
      (screens[0] as FakeTransceiver).sender.stats = senderStats(
        0.1,
        AV1,
        { bytesSent: i * 1_000_000, timestamp: i * 4_000 },
        "cpu",
      );
      await ana.mesh.adjust();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(ana.mesh.quality()[0]?.screen?.rung).not.toBe(rung);
    ana.mesh.close();
  });

  it("calls setParameters per pair, a few hundred ms apart, and setCodecPreferences on every transceiver", async () => {
    const { ana, screens, pass } = await sharing(["bo", "cy", "di"]);
    for (let i = 0; i < 3; i++) await pass();
    const calls = () => screens.map((t) => t.sender.setCalls);
    const before = calls();
    await pass();
    // Every video transceiver ranks the abandoned codecs last: H.264, VP8, AV1, VP9.
    for (const t of screens) {
      expect(prefers(t)).toEqual([H264, "video/VP8", AV1, "video/VP9", "video/rtx"]);
    }
    // The first pair at once, with the cap of its new codec (1.5x) in the same call...
    const change = () => calls().map((n, i) => n - (before[i] as number));
    expect(change()).toEqual([1, 0, 0]);
    expect(encoding(screens[0] as FakeTransceiver).maxBitrate).toBe(
      1.5 * (rungCap(ana.mesh.quality()[0]?.screen?.rung) as number),
    );
    // ...then the others, one after another.
    await vi.advanceTimersByTimeAsync(CODEC_SWITCH_STAGGER_MS);
    expect(change()).toEqual([1, 1, 0]);
    await vi.advanceTimersByTimeAsync(CODEC_SWITCH_STAGGER_MS);
    expect(change()).toEqual([1, 1, 1]);
    expect(screens.map(codecOf)).toEqual([H264, H264, H264]);
    // Once it holds nothing is applied again.
    await pass({ codec: H264, limited: () => false });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(change()).toEqual([1, 1, 1]);
    ana.mesh.close();
  });

  it("needs half of the pairs, and one pair is enough with one viewer", async () => {
    const third = await sharing(["bo", "cy", "di"]);
    for (let i = 0; i < 6; i++) await third.pass({ limited: (pair) => pair === 0 });
    expect(third.screens.map(codecOf)).toEqual([undefined, undefined, undefined]);
    third.ana.mesh.close();
    const half = await sharing(["bo", "cy", "di", "ed"]);
    for (let i = 0; i < 4; i++) await half.pass({ limited: (pair) => pair < 2 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(half.screens.map(codecOf)).toEqual([H264, H264, H264, H264]);
    half.ana.mesh.close();
    const alone = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await alone.pass();
    expect(codecOf(alone.screens[0] as FakeTransceiver)).toBe(H264);
    alone.ana.mesh.close();
  });

  it("counts pairs, not senders: a screen and a camera to each viewer are still three pairs", async () => {
    // Two of three pairs have their screen CPU-limited, and no camera is: two of six senders, but
    // two of three pairs.
    const two = await sharing(["bo", "cy", "di"], { cam: true });
    for (let i = 0; i < 4; i++)
      await two.pass({ limited: (pair) => pair < 2, camLimited: () => false });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(two.screens.map(codecOf)).toEqual([H264, H264, H264]);
    expect(two.cams.map(codecOf)).toEqual([H264, H264, H264]);
    two.ana.mesh.close();
    const one = await sharing(["bo", "cy", "di"], { cam: true });
    for (let i = 0; i < 6; i++)
      await one.pass({ limited: (pair) => pair < 1, camLimited: () => false });
    expect(one.screens.map(codecOf)).toEqual([undefined, undefined, undefined]);
    one.ana.mesh.close();
  });

  it("switches from VP9, and never from H.264 or VP8: a CPU limit there is pressure for the steps", async () => {
    const vp9 = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await vp9.pass({ codec: "video/VP9" });
    expect(codecOf(vp9.screens[0] as FakeTransceiver)).toBe(H264);
    vp9.ana.mesh.close();
    for (const costly of [H264, "video/VP8"]) {
      const { ana, screens, pass } = await sharing(["bo"]);
      for (let i = 0; i < 6; i++) await pass({ codec: costly });
      expect(codecOf(screens[0] as FakeTransceiver)).toBeUndefined();
      expect(ana.mesh.quality()[0]?.screen?.rung).not.toBe("1080p60");
      ana.mesh.close();
    }
  });

  it("goes to VP8 on a pair where H.264 isn't on both sides, and to nothing where it has neither", async () => {
    const noH264 = await sharing(["bo"], {
      formats: negotiated.filter((c) => c.mimeType !== H264),
    });
    for (let i = 0; i < 4; i++) await noH264.pass();
    expect(codecOf(noH264.screens[0] as FakeTransceiver)).toBe("video/VP8");
    noH264.ana.mesh.close();
    const neither = await sharing(["bo"], { formats: negotiated.slice(0, 2) });
    for (let i = 0; i < 4; i++) await neither.pass();
    expect(codecOf(neither.screens[0] as FakeTransceiver)).toBeUndefined();
    neither.ana.mesh.close();
  });

  it("switches once: the step is kept, and a CPU limit is pressure again after the warm-up", async () => {
    const { ana, screens, pass, rows } = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await pass();
    const rung = ana.mesh.quality()[0]?.screen?.rung;
    // H.264 reads a CPU limit too: two warm-up readings, then the controller steps down. The
    // trigger doesn't fire a second time.
    for (let i = 0; i < 3; i++) await pass({ codec: H264 });
    expect(ana.mesh.quality()[0]?.screen?.rung).toBe(rung);
    await pass({ codec: H264 });
    await pass({ codec: H264 });
    expect(ana.mesh.quality()[0]?.screen?.rung).not.toBe(rung);
    expect(sentRows(rows).filter((r) => r.trigger === "codec")).toHaveLength(1);
    expect(codecOf(screens[0] as FakeTransceiver)).toBe(H264);
    ana.mesh.close();
  });

  it("emits the codec row, and leaves out a reading that still names the old codec", async () => {
    const { ana, pass, rows } = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await pass();
    const rung = ana.mesh.quality()[0]?.screen?.rung;
    expect(sentRows(rows).map((r) => [r.trigger, r.codec, r.fromCodec])).toEqual([
      ["codec", H264, AV1],
    ]);
    expect(sentRows(rows)[0]).toMatchObject({ rung, codecReason: "cpu", toRung: null });
    // The stats lag the change by a pass: that reading is still AV1, and is in no window.
    await pass({ codec: AV1 });
    for (let i = 0; i < 8; i++) await pass({ codec: H264, limited: () => false });
    const later = sentRows(rows).slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const row of later)
      expect([row.trigger, row.codec, row.codecReason]).toEqual(["window", H264, "cpu"]);
    ana.mesh.close();
  });

  it("tells the room timeline once, with both codecs, however many pairs move", async () => {
    const { ana, pass, reports } = await sharing(["bo", "cy"], { cam: true });
    for (let i = 0; i < 4; i++) await pass();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reports.filter((e) => e.kind === "codec_switch")).toEqual([
      { kind: "codec_switch", from: AV1, to: H264, reason: "cpu" },
    ]);
    // No second switch, no second report; and the next share can switch (and tell) again.
    for (let i = 0; i < 4; i++) await pass({ codec: H264, limited: () => false });
    expect(reports.filter((e) => e.kind === "codec_switch")).toHaveLength(1);
    ana.mesh.close();
  });

  it("tells each viewer in the step message, and both ends keep it for their modal", async () => {
    const { ana, viewers, pass } = await sharing(["bo"]);
    const [bo] = viewers as [(typeof viewers)[number]];
    for (let i = 0; i < 2; i++) await pass({ limited: () => false });
    // Before the switch: the normal order, no switch.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      side: "viewer",
      note: { codecReason: "preferred" },
      switches: [],
    });
    for (let i = 0; i < 4; i++) await pass();
    await vi.advanceTimersByTimeAsync(1_000);
    await pass({ codec: H264, limited: () => false });
    await vi.advanceTimersByTimeAsync(1_000);
    const heard = bo.mesh.streamQuality("ana") as Extract<QualityView, { side: "viewer" }>;
    expect(heard.note).toMatchObject({
      codecReason: "cpu",
      codecSwitch: { from: AV1, to: H264 },
    });
    expect(heard.switches).toMatchObject([{ from: AV1, to: H264 }]);
    const own = ana.mesh.streamQuality("ana") as Extract<QualityView, { side: "streamer" }>;
    expect(own.switches).toMatchObject([{ userId: "bo", from: AV1, to: H264 }]);
    expect(own.viewers[0]?.note).toMatchObject({ codecReason: "cpu" });
    ana.mesh.close();
  });

  it("heals a pick that a negotiation reverted on the next pass", async () => {
    const { ana, screens, pass } = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await pass();
    const toBo = screens[0] as FakeTransceiver;
    // Chromium drops the pick when a later description's fmtp differs: it reports none.
    await toBo.sender.setParameters({
      ...toBo.sender.getParameters(),
      encodings: [{ ...encoding(toBo), codec: undefined } as CodecEncoding],
    });
    expect(codecOf(toBo)).toBeUndefined();
    const calls = toBo.sender.setCalls;
    await pass({ codec: AV1, limited: () => false });
    expect(codecOf(toBo)).toBe(H264);
    expect(toBo.sender.setCalls).toBe(calls + 1);
    ana.mesh.close();
  });

  it("starts a viewer who joins after the switch on H.264", async () => {
    const { ana, network, pass, rows } = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await pass();
    vi.useRealTimers();
    const cy = page("cy", network, undefined, capable);
    for (const mesh of network.values()) {
      mesh.join([{ userId: "ana" }, { userId: "bo" }, { userId: "cy" }]);
    }
    await settle();
    connect({ pcs: [ana.pcs[1] as FakePC] }, cy);
    await settle();
    const toCy = ana.pcs[1]?.transceivers.find((t) => t.sender.track) as FakeTransceiver;
    expect(prefers(toCy)).toEqual([H264, "video/VP8", AV1, "video/VP9", "video/rtx"]);
    // It negotiated H.264 already: its reading names it, and it gets no switch row of its own.
    toCy.sender.codecs = [codec(H264, "profile-level-id=42e01f"), codec("video/VP8")];
    toCy.sender.stats = senderStats(0, H264, { bytesSent: 1, timestamp: 1_000 }, "none");
    for (let i = 0; i < 3; i++) await ana.mesh.adjust();
    expect(rows.filter((r) => r.trigger === "codec" && r.direction === "send")).toHaveLength(1);
    expect(ana.mesh.quality().find((q) => q.userId === "cy")?.screen?.codec).toBe(H264);
    expect(codecOf(toCy)).toBeUndefined();
    ana.mesh.close();
  });

  it("does not take an empty read-back after the codec worked for a browser without it", async () => {
    const { ana, screens, pass } = await sharing(["bo"]);
    const offers = () =>
      ana.sent.filter((p) => p.kind === "description" && p.description.type === "offer").length;
    for (let i = 0; i < 4; i++) await pass();
    const toBo = screens[0] as FakeTransceiver;
    expect(codecOf(toBo)).toBe(H264);
    const before = offers();
    // A negotiation reverts the pick, and the call that puts it back reads back nothing (the
    // revert landed between the call and the read).
    await toBo.sender.setParameters({
      ...toBo.sender.getParameters(),
      encodings: [{ ...encoding(toBo), codec: undefined } as CodecEncoding],
    });
    browser.takesEncodingCodec = false;
    await pass({ limited: () => false });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(codecOf(toBo)).toBeUndefined();
    expect(offers()).toBe(before);
    // The browser still takes it: the next pass puts it back.
    browser.takesEncodingCodec = true;
    await pass({ limited: () => false });
    expect(codecOf(toBo)).toBe(H264);
    expect(offers()).toBe(before);
    ana.mesh.close();
  });

  it("falls back to renegotiating where the browser takes no encodings[].codec", async () => {
    browser.takesEncodingCodec = false;
    const { ana, screens, pass } = await sharing(["bo", "cy"]);
    const offers = () =>
      ana.sent.filter((p) => p.kind === "description" && p.description.type === "offer").length;
    const before = offers();
    for (let i = 0; i < 3; i++) await pass();
    await pass();
    await vi.advanceTimersByTimeAsync(2_000);
    // The preferences are on every transceiver and no codec is in the encodings; each pair got
    // a new offer, which carries them. Nothing asks the browser for the codec again.
    for (const t of screens) {
      expect(codecOf(t)).toBeUndefined();
      expect(prefers(t)[0]).toBe(H264);
    }
    expect(offers() - before).toBe(2);
    ana.mesh.close();
  });

  it("resets with the share: the order goes back, and the next share can switch again", async () => {
    const { ana, screens, pass } = await sharing(["bo"]);
    for (let i = 0; i < 4; i++) await pass();
    expect(prefers(screens[0] as FakeTransceiver)[0]).toBe(H264);
    ana.mesh.setLocalTracks({ screen: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(prefers(screens[0] as FakeTransceiver)[0]).toBe(AV1);
    ana.mesh.setLocalTracks({
      screen: trackWith("again", { width: 1920, height: 1080, frameRate: 60 }, "text"),
    });
    await vi.advanceTimersByTimeAsync(0);
    // The sender still carries the last share's pick until the new share's first tune puts it
    // back on the start order; the new share is a fresh state: warm-up, then the same trigger.
    expect(codecOf(screens[0] as FakeTransceiver)).toBe(AV1);
    for (let i = 0; i < 3; i++) await pass();
    expect(codecOf(screens[0] as FakeTransceiver)).toBe(AV1);
    await pass();
    expect(codecOf(screens[0] as FakeTransceiver)).toBe(H264);
    ana.mesh.close();
  });

  it("puts the camera back on its start order, in one setParameters, when the share ends", async () => {
    const { ana, cams, pass } = await sharing(["bo"], { cam: true });
    const camera = cams[0] as FakeTransceiver;
    const cap = encoding(camera).maxBitrate;
    for (let i = 0; i < 4; i++) await pass();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(encoding(camera).maxBitrate).toBe(1.5 * (cap as number));
    expect(codecOf(camera)).toBe(H264);
    expect(prefers(camera)[0]).toBe(H264);
    const calls = camera.sender.setCalls;
    ana.mesh.setLocalTracks({ screen: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(prefers(camera)[0]).toBe(AV1);
    expect(codecOf(camera)).toBe(AV1);
    // The cap of AV1 goes out in the same call, not 1.5x for a pass more.
    expect(encoding(camera).maxBitrate).toBe(cap);
    expect(camera.sender.setCalls).toBe(calls + 1);
    ana.mesh.close();
  });

  it("keeps a switch made with only a camera on until the camera turns off", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, capable);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const camera = trackWith("ana cam", { width: 640, height: 360, frameRate: 15 });
    ana.mesh.setLocalTracks({ cam: camera });
    await settle();
    connect(ana, bo);
    await settle();
    const toBo = carrying(ana.pcs[0], camera) as FakeTransceiver;
    toBo.sender.codecs = negotiated;
    vi.useFakeTimers();
    for (let i = 1; i <= 4; i++) {
      toBo.sender.stats = senderStats(
        0,
        AV1,
        { bytesSent: i * 100_000, timestamp: i * 4_000 },
        "cpu",
      );
      await ana.mesh.adjust();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(codecOf(toBo)).toBe(H264);
    // A screen starting and stopping meanwhile doesn't end it.
    ana.mesh.setLocalTracks({
      screen: trackWith("s", { width: 1920, height: 1080, frameRate: 60 }),
    });
    ana.mesh.setLocalTracks({ screen: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(prefers(toBo)[0]).toBe(H264);
    ana.mesh.setLocalTracks({ cam: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(prefers(toBo)[0]).toBe(AV1);
    ana.mesh.close();
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
    ana.mesh.setLocalTracks({
      screen: trackWith("s", { width: 1920, height: 1080, frameRate: 60 }),
    });
    bo.mesh.setLocalTracks({ cam: trackWith("c", { width: 640, height: 360, frameRate: 15 }) });
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

  describe("the streamer's start order", () => {
    const chromiumWithH264: VideoCodecs = {
      send: [
        codec("video/VP8"),
        codec("video/AV1"),
        codec("video/VP9"),
        codec("video/H264"),
        codec("video/rtx"),
      ],
      receive: ["video/VP8", "video/AV1", "video/VP9", "video/H264"],
    };
    const capture = { width: 1920, height: 1080, frameRate: 30 };
    const types = (t: FakeTransceiver | undefined) => t?.codecPreferences.map((c) => c.mimeType);
    const carryingId = (pc: FakePC | undefined, id: string) =>
      pc?.transceivers.find((t) => (t.sender.track as { id?: string } | null)?.id === id);

    /** Ana and bo, in the room. */
    function pair(viewer: VideoCodecs = chromiumWithH264) {
      const network = new Map<string, Mesh>();
      const ana = page("ana", network, undefined, chromiumWithH264);
      const bo = page("bo", network, undefined, viewer);
      for (const mesh of network.values()) mesh.join(everyone);
      return { ana, bo };
    }

    it("sends a Firefox streamer's screen as H.264 or VP8 only", async () => {
      const { ana, bo } = pair();
      ana.mesh.setStartOrder("screen", FIREFOX_START);
      ana.mesh.setLocalTracks({ screen: trackWith("s", capture) });
      await settle();
      expect(types(sender(ana.pcs[0]))).toEqual(["video/H264", "video/VP8", "video/rtx"]);
      ana.mesh.close();
      bo.mesh.close();
    });

    it("offers the normal order for a kind that was given no order", async () => {
      const { ana, bo } = pair();
      ana.mesh.setLocalTracks({ screen: trackWith("s", capture) });
      await settle();
      expect(types(sender(ana.pcs[0]))).toEqual([
        "video/AV1",
        "video/VP9",
        "video/H264",
        "video/VP8",
        "video/rtx",
      ]);
      ana.mesh.close();
      bo.mesh.close();
    });

    it("applies the order to a late joiner", async () => {
      const network = new Map<string, Mesh>();
      const ana = page("ana", network, undefined, chromiumWithH264);
      ana.mesh.join([{ userId: "ana" }]);
      ana.mesh.setStartOrder("screen", HARDWARE_VP9_START);
      ana.mesh.setLocalTracks({ screen: trackWith("s", capture) });
      await settle();
      const bo = page("bo", network, undefined, chromiumWithH264);
      for (const mesh of network.values()) mesh.join(everyone);
      await settle();
      expect(types(sender(ana.pcs[0]))?.slice(0, 2)).toEqual(["video/VP9", "video/AV1"]);
      ana.mesh.close();
      bo.mesh.close();
    });

    it("leaves out of a pair a codec its viewer can't decode", async () => {
      const noVp9: VideoCodecs = { ...chromiumWithH264, receive: ["video/AV1", "video/VP8"] };
      const { ana, bo } = pair(noVp9);
      await settle();
      ana.mesh.setStartOrder("screen", HARDWARE_VP9_START);
      ana.mesh.setLocalTracks({ screen: trackWith("s", capture) });
      await settle();
      expect(types(sender(ana.pcs[0]))).toEqual(["video/AV1", "video/VP8", "video/rtx"]);
      ana.mesh.close();
      bo.mesh.close();
    });

    it("keeps the screen's order apart from the camera's", async () => {
      const { ana, bo } = pair();
      ana.mesh.setStartOrder("screen", FIREFOX_START);
      ana.mesh.setStartOrder("cam", HARDWARE_VP9_START);
      ana.mesh.setLocalTracks({
        screen: trackWith("s", capture),
        cam: trackWith("c", { width: 640, height: 360, frameRate: 15 }),
      });
      await settle();
      expect(types(carryingId(ana.pcs[0], "s"))?.[0]).toBe("video/H264");
      expect(types(carryingId(ana.pcs[0], "c"))?.[0]).toBe("video/VP9");
      ana.mesh.close();
      bo.mesh.close();
    });

    it("keeps an order while its kind is on, and forgets it when the kind goes off", async () => {
      const { ana, bo } = pair();
      ana.mesh.setStartOrder("cam", FIREFOX_START);
      ana.mesh.setLocalTracks({ cam: trackWith("c1", capture) });
      await settle();
      expect(types(carryingId(ana.pcs[0], "c1"))).toEqual(["video/H264", "video/VP8", "video/rtx"]);
      // Another camera while on: the same order.
      ana.mesh.setLocalTracks({ cam: trackWith("c2", capture) });
      await settle();
      expect(types(carryingId(ana.pcs[0], "c2"))?.[0]).toBe("video/H264");
      // Off, then on with no order given: the normal one, on the transceiver it kept.
      ana.mesh.setLocalTracks({ cam: null });
      await settle();
      ana.mesh.setLocalTracks({ cam: trackWith("c3", capture) });
      await settle();
      expect(types(carryingId(ana.pcs[0], "c3"))?.[0]).toBe("video/AV1");
      // And with a new one given: it takes it, the kept transceiver too.
      ana.mesh.setStartOrder("cam", HARDWARE_VP9_START);
      expect(types(carryingId(ana.pcs[0], "c3"))?.[0]).toBe("video/VP9");
      ana.mesh.close();
      bo.mesh.close();
    });

    it("sends a share's screen and its audio in one negotiation, on the order given", async () => {
      // Ana is the impolite side (zoe > ana), so she offers first.
      const network = new Map<string, Mesh>();
      const zoe = page("zoe", network, undefined, chromiumWithH264);
      const ana = page("ana", network, undefined, chromiumWithH264);
      for (const mesh of network.values()) mesh.join([{ userId: "ana" }, { userId: "zoe" }]);
      await settle();
      const offers = () =>
        zoe.sent.flatMap((p) =>
          p.kind === "description" && p.description.type === "offer" ? [p] : [],
        ).length;
      const before = offers();
      zoe.mesh.setStartOrder("screen", FIREFOX_START);
      zoe.mesh.setLocalTracks({
        screen: trackWith("s", capture),
        screenAudio: track("share audio"),
      });
      await settle();
      expect(offers() - before).toBe(1);
      const pc = zoe.pcs[0];
      expect(carryingId(pc, "s")?.mid).not.toBeNull();
      expect(carryingId(pc, "share audio")?.mid).not.toBeNull();
      expect(types(carryingId(pc, "s"))?.[0]).toBe("video/H264");
      zoe.mesh.close();
      ana.mesh.close();
    });

    it("does nothing with an order once closed", async () => {
      const { ana, bo } = pair();
      await settle();
      ana.mesh.close();
      expect(() => ana.mesh.setStartOrder("screen", FIREFOX_START)).not.toThrow();
      bo.mesh.close();
    });
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

  // What the Mesh tells the room timeline about each pair (#116): `onReport` gets a
  // `ConnectionEvent` for every connection state, restart (and whether it recovered), path and
  // negotiation error.
  describe("connection events (#116)", () => {
    /** A page for `userId` whose reports are collected in `reports`. */
    function reporting(
      userId: string,
      network: Map<string, Mesh>,
      extra: Partial<MeshOptions> = {},
      servers: RTCIceServer[] = turn,
    ) {
      const reports: ConnectionEvent[] = [];
      const p = page(userId, network, servers, undefined, undefined, {
        onReport: (event) => reports.push(event),
        ...extra,
      });
      return { ...p, reports };
    }
    /** Ana and bo, negotiated (not yet connected), both reporting. */
    async function reported(anaExtra: Partial<MeshOptions> = {}) {
      vi.useFakeTimers();
      const network = new Map<string, Mesh>();
      const ana = reporting("ana", network, anaExtra);
      const bo = reporting("bo", network);
      ana.mesh.join(everyone);
      bo.mesh.join(everyone);
      await tick();
      return { ana, bo, anaPc: ana.pcs[0] as FakePC, boPc: bo.pcs[0] as FakePC };
    }
    /** The reports of one kind, without the peer (always bo here). */
    const of = (reports: ConnectionEvent[], kind: ConnectionEvent["kind"]) =>
      reports.filter((r) => r.kind === kind);
    const stateNames = (reports: ConnectionEvent[]) =>
      reports.flatMap((r) => (r.kind === "pair_state" ? [r.state] : []));

    /** A direct pair: host candidates on both ends, over UDP. */
    const directStats = () =>
      new Map<string, unknown>(
        [
          { id: "T", type: "transport", selectedCandidatePairId: "P" },
          { id: "P", type: "candidate-pair", localCandidateId: "L", remoteCandidateId: "R" },
          { id: "L", type: "local-candidate", candidateType: "host", protocol: "udp" },
          { id: "R", type: "remote-candidate", candidateType: "srflx", protocol: "udp" },
        ].map((s) => [s.id, s]),
      );

    it("reports each connection state a pair goes through, and its path when it connects", async () => {
      const { ana, anaPc } = await reported();
      anaPc.setConnectionState("connecting");
      anaPc.stats = directStats();
      anaPc.setConnectionState("connected");
      await tick();
      anaPc.setConnectionState("disconnected");
      anaPc.setConnectionState("connected");
      await tick();
      expect(stateNames(ana.reports)).toEqual([
        "connecting",
        "connected",
        "disconnected",
        "connected",
      ]);
      expect(ana.reports.every((r) => "peerId" in r && r.peerId === "bo")).toBe(true);
      // A path at each connect, with the candidate types and transport and no address.
      const paths = of(ana.reports, "pair_path");
      expect(paths).toEqual([
        {
          kind: "pair_path",
          peerId: "bo",
          change: "connect",
          path: "direct",
          local: { type: "host", protocol: "udp" },
          remote: { type: "srflx", protocol: "udp" },
        },
        expect.objectContaining({ change: "connect", path: "direct" }),
      ]);
      expect(JSON.stringify(ana.reports)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    });

    it("reports a relayed pair's path with the transport to the TURN server", async () => {
      const { bo, boPc } = await reported();
      boPc.stats = relayStats();
      boPc.setConnectionState("connected");
      await tick();
      expect(of(bo.reports, "pair_path")).toMatchObject([
        { path: "relay", local: { type: "relay", protocol: "udp", relayProtocol: "tls" } },
      ]);
    });

    it("reports a path change on the next quality pass, and only a change", async () => {
      const { ana, anaPc } = await reported();
      anaPc.stats = directStats();
      anaPc.setConnectionState("connected");
      await tick();
      await ana.mesh.adjust();
      await tick();
      expect(of(ana.reports, "pair_path")).toHaveLength(1);

      // The pair in use moves to a relay.
      anaPc.stats = relayStats();
      await ana.mesh.adjust();
      await tick();
      expect(of(ana.reports, "pair_path").at(-1)).toMatchObject({
        change: "change",
        path: "relay",
      });
      await ana.mesh.adjust();
      await tick();
      expect(of(ana.reports, "pair_path")).toHaveLength(2);
    });

    it("never lets a slow or hung path read hold up the quality pass", async () => {
      const { ana, anaPc } = await reported();
      anaPc.stats = directStats();
      anaPc.setConnectionState("connected");
      await tick();
      // The connection's stats never come back. The pass still ends (it would hang on the read
      // if it waited), and asks only once while that read is out.
      let reads = 0;
      anaPc.getStats = () => {
        reads++;
        return new Promise(() => {});
      };
      await ana.mesh.adjust();
      await ana.mesh.adjust();
      await ana.mesh.adjust();
      expect(reads).toBe(1);
      expect(of(ana.reports, "pair_path")).toHaveLength(1);
    });

    it("adjusts the senders before it reads the path, and not after waiting for it", async () => {
      const { ana, anaPc } = await reported();
      anaPc.stats = directStats();
      anaPc.setConnectionState("connected");
      await tick();
      const order: string[] = [];
      anaPc.getStats = async () => {
        order.push("path");
        return anaPc.stats;
      };
      const cam = track("ana cam");
      ana.mesh.setLocalTracks({ cam });
      await tick();
      const sender = anaPc.transceivers.find((t) => t.sender.track === cam)?.sender;
      if (!sender) throw new Error("the camera is not being sent");
      sender.getStats = async () => {
        order.push("sender");
        return sender.stats;
      };
      order.length = 0;
      await ana.mesh.adjust();
      await tick();
      // The pass's own read first; the path read after it (and not waited for).
      expect(order).toEqual(["sender", "path"]);
    });

    it("reports an ICE restart and that it recovered", async () => {
      const { ana, anaPc } = await reported();
      anaPc.setConnectionState("connected");
      await tick();
      anaPc.setConnectionState("failed");
      await tick();
      await vi.advanceTimersByTimeAsync(2_500);
      anaPc.setConnectionState("connected");
      await tick();
      expect(of(ana.reports, "pair_restart")).toEqual([
        { kind: "pair_restart", peerId: "bo", how: "ice_restart", why: "failed" },
      ]);
      expect(of(ana.reports, "pair_recovery")).toEqual([
        {
          kind: "pair_recovery",
          peerId: "bo",
          how: "ice_restart",
          recovered: true,
          afterMs: 2_520,
        },
      ]);
    });

    it("reports an ICE restart that did not recover, when the pair gives up", async () => {
      const { ana, anaPc } = await reported();
      anaPc.setConnectionState("connected");
      await tick();
      anaPc.setConnectionState("failed");
      await tick();
      anaPc.setConnectionState("failed");
      await tick();
      expect(of(ana.reports, "pair_recovery")).toMatchObject([
        { how: "ice_restart", recovered: false },
      ]);
      expect(stateNames(ana.reports).at(-1)).toBe("failed");
    });

    it("says a restart was because connecting took too long, or because TURN arrived", async () => {
      vi.useFakeTimers();
      const network = new Map<string, Mesh>();
      const stun = [{ urls: "stun:stun.example:3478" }];
      const ana = reporting("ana", network, {}, stun);
      const bo = reporting("bo", network, {}, stun);
      ana.mesh.join(everyone);
      bo.mesh.join(everyone);
      await tick();
      const anaPc = ana.pcs[0] as FakePC;
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      await tick();
      expect(of(ana.reports, "pair_restart")).toMatchObject([
        { how: "ice_restart", why: "timeout" },
      ]);
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      await tick();
      ana.mesh.setIceServers([{ urls: "stun:other.example:3478" }]);
      ana.mesh.setIceServers(turn);
      await tick();
      expect(of(ana.reports, "pair_restart").at(-1)).toMatchObject({ why: "turn" });
      expect(anaPc.iceRestarts).toBe(2);
    });

    it("reports a pair that never negotiated, its automatic start-over and that it did not recover", async () => {
      vi.useFakeTimers();
      const network = new Map<string, Mesh>();
      // Bo's offers go nowhere: ana's page isn't there.
      const bo = reporting("bo", network);
      bo.mesh.join(everyone);
      await tick();
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      await tick();
      expect(of(bo.reports, "negotiation_error")).toMatchObject([
        { peerId: "ana", step: "never_finished" },
      ]);
      expect(of(bo.reports, "pair_restart")).toEqual([
        { kind: "pair_restart", peerId: "ana", how: "start_over", why: "timeout" },
      ]);
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      await tick();
      expect(of(bo.reports, "negotiation_error")).toHaveLength(2);
      expect(of(bo.reports, "pair_recovery")).toMatchObject([
        { how: "start_over", recovered: false, afterMs: CONNECT_TIMEOUT_MS },
      ]);
    });

    it("reports that a start-over connected", async () => {
      vi.useFakeTimers();
      const network = new Map<string, Mesh>();
      const bo = reporting("bo", network);
      const ana = reporting("ana", network);
      network.delete("ana");
      bo.mesh.join(everyone);
      ana.mesh.join(everyone);
      await tick();
      network.set("ana", ana.mesh);
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
      await tick();
      const open = bo.pcs.find((pc) => pc.signalingState !== "closed") as FakePC;
      open.setConnectionState("connected");
      await tick();
      expect(of(bo.reports, "pair_recovery")).toMatchObject([
        { how: "start_over", recovered: true },
      ]);
    });

    it("reports a start-over the person asked for, and one the peer began", async () => {
      const { ana, anaPc } = await reported();
      anaPc.setConnectionState("failed");
      await tick();
      anaPc.setConnectionState("failed");
      await tick();
      ana.mesh.retry("bo");
      await tick();
      expect(of(ana.reports, "pair_restart").at(-1)).toEqual({
        kind: "pair_restart",
        peerId: "bo",
        how: "start_over",
        why: "retry",
      });
    });

    it("reports a start-over the peer began (a reload): this side starts over too", async () => {
      vi.useFakeTimers();
      // Ana alone: the peer's page is only what these two hellos say.
      const ana = reporting("ana", new Map());
      ana.mesh.join(everyone);
      await tick();
      ana.mesh.receive("bo", { kind: "hello", session: "bo-1" });
      ana.mesh.receive("bo", { kind: "hello", session: "bo-2" });
      await tick();
      expect(of(ana.reports, "pair_restart")).toEqual([
        { kind: "pair_restart", peerId: "bo", how: "start_over", why: "peer" },
      ]);
    });

    it("reports a failed offer, and a description the browser refused", async () => {
      const log = vi.fn();
      const { ana, bo, anaPc } = await reported({ log });
      anaPc.setLocalDescription = async () => {
        throw Object.assign(new Error("offer blocked"), { name: "InvalidStateError" });
      };
      ana.mesh.setLocalTracks({ cam: track("ana cam") });
      await tick();
      expect(of(ana.reports, "negotiation_error")).toEqual([
        {
          kind: "negotiation_error",
          peerId: "bo",
          step: "offer",
          name: "InvalidStateError",
          message: "offer blocked",
        },
      ]);

      anaPc.setRemoteDescription = async () => {
        throw Object.assign(new Error("Failed to parse SessionDescription at 10.1.2.3"), {
          name: "InvalidAccessError",
        });
      };
      ana.mesh.receive("bo", {
        kind: "description",
        // The session bo has been using with ana.
        session: bo.sent[0]?.session as string,
        description: { type: "offer", sdp: "[]" },
      });
      await tick();
      const refused = of(ana.reports, "negotiation_error").at(-1);
      expect(refused).toMatchObject({
        step: "remote_description",
        name: "InvalidAccessError",
        message: "Failed to parse SessionDescription at [ip]",
      });
      expect(log).toHaveBeenCalled();
    });

    it("reports a refused candidate once, not for every one trickled after a bad description", async () => {
      const log = vi.fn();
      const { ana, bo, anaPc } = await reported({ log });
      const session = bo.sent[0]?.session as string;
      anaPc.addIceCandidate = async () => {
        throw Object.assign(new Error("bad candidate"), { name: "OperationError" });
      };
      const trickle = () =>
        ana.mesh.receive("bo", {
          kind: "candidate",
          session,
          candidate: { candidate: "candidate:1 1 udp 1 1.1.1.1 1 typ host" },
        } as SignalPayload);
      for (let i = 0; i < 25; i++) trickle();
      await tick();
      expect(of(ana.reports, "negotiation_error")).toMatchObject([
        { step: "candidate", name: "OperationError" },
      ]);

      // A description that is applied starts it afresh: the next refused candidate is news again.
      bo.mesh.setLocalTracks({ cam: track("bo cam") });
      await tick();
      trickle();
      trickle();
      await tick();
      expect(of(ana.reports, "negotiation_error")).toHaveLength(2);
    });

    it("is not broken by a listener that throws", async () => {
      vi.useFakeTimers();
      const network = new Map<string, Mesh>();
      const ana = reporting("ana", network, {
        onReport: () => {
          throw new Error("reporter down");
        },
      });
      const bo = reporting("bo", network);
      ana.mesh.join(everyone);
      bo.mesh.join(everyone);
      await tick();
      (ana.pcs[0] as FakePC).setConnectionState("connected");
      await tick();
      expect(ana.mesh.peers()).toMatchObject([{ userId: "bo", state: "connected" }]);
    });

    it("stops reporting once closed", async () => {
      const { ana, bo, anaPc } = await reported();
      anaPc.setConnectionState("connected");
      await tick();
      const before = ana.reports.length;
      ana.mesh.close();
      anaPc.setConnectionState("failed");
      await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2);
      expect(ana.reports).toHaveLength(before);
      expect(bo.reports.length).toBeGreaterThan(0);
    });
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

describe("sentCodecOf", () => {
  const section = (mid: string, line: string, ...rtpmaps: string[]) =>
    [`m=video 9 UDP/TLS/RTP/SAVPF ${line}`, `a=mid:${mid}`, ...rtpmaps, ""].join("\r\n");
  const sdp = (...sections: string[]) =>
    ["v=0", "o=- 1 2 IN IP4 127.0.0.1", ...sections].join("\r\n");
  const rtpmaps = [
    "a=rtpmap:96 VP8/90000",
    "a=rtpmap:97 rtx/90000",
    "a=rtpmap:98 VP9/90000",
    "a=rtpmap:102 H264/90000",
    "a=rtpmap:103 red/90000",
  ];

  it("is the first payload type of the section's m-line that carries media, as its MIME type", () => {
    const mids = new Set(["1"]);
    expect(sentCodecOf(sdp(section("1", "102 96 97 98", ...rtpmaps)), mids)).toBe("video/H264");
    expect(sentCodecOf(sdp(section("1", "98 96 97", ...rtpmaps)), mids)).toBe("video/VP9");
    expect(sentCodecOf(sdp(section("1", "96 98", ...rtpmaps)), mids)).toBe("video/VP8");
  });

  it("skips retransmission and redundancy formats, which carry no media themselves", () => {
    const mids = new Set(["1"]);
    expect(sentCodecOf(sdp(section("1", "97 103 102 96", ...rtpmaps)), mids)).toBe("video/H264");
    expect(sentCodecOf(sdp(section("1", "97 103", ...rtpmaps)), mids)).toBeUndefined();
  });

  it("reads only the section whose mid is asked for", () => {
    const two = sdp(section("0", "96 98", ...rtpmaps), section("1", "102 96", ...rtpmaps));
    expect(sentCodecOf(two, new Set(["0"]))).toBe("video/VP8");
    expect(sentCodecOf(two, new Set(["1"]))).toBe("video/H264");
    expect(sentCodecOf(two, new Set(["2"]))).toBeUndefined();
    expect(sentCodecOf(two, new Set())).toBeUndefined();
  });

  it("says nothing of an audio section, or a payload type with no rtpmap", () => {
    const audio = ["m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=mid:1", "a=rtpmap:111 opus/48000/2", ""];
    expect(sentCodecOf(sdp(audio.join("\r\n")), new Set(["1"]))).toBeUndefined();
    expect(sentCodecOf(sdp(section("1", "45 96", ...rtpmaps)), new Set(["1"]))).toBe("video/VP8");
  });
});

describe("withStartBitrate", () => {
  /** A Chromium-like description: share audio (mid 0), the screen (mid 1), a camera (mid 2). */
  const video = (mid: string) => [
    "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 102 103 104 105",
    `a=mid:${mid}`,
    "a=rtpmap:96 VP8/90000",
    "a=rtcp-fb:96 goog-remb",
    "a=rtpmap:97 rtx/90000",
    "a=fmtp:97 apt=96",
    "a=rtpmap:98 VP9/90000",
    "a=fmtp:98 profile-id=0",
    "a=rtpmap:99 rtx/90000",
    "a=fmtp:99 apt=98",
    "a=rtpmap:100 AV1/90000",
    "a=fmtp:100 level-idx=5;profile=0;tier=0",
    "a=rtpmap:101 rtx/90000",
    "a=fmtp:101 apt=100",
    "a=rtpmap:102 H264/90000",
    "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=rtpmap:103 rtx/90000",
    "a=fmtp:103 apt=102",
    "a=rtpmap:104 red/90000",
    "a=rtpmap:105 ulpfec/90000",
  ];
  const sdp = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=mid:0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    ...video("1"),
    ...video("2"),
    "",
  ].join("\r\n");
  const screen = new Set(["1"]);
  const section = (text: string, mid: string) =>
    text.split(/\r\n(?=m=)/).find((s) => s.includes(`a=mid:${mid}\r\n`)) as string;

  it("asks for the start bitrate, in kbps, on each video codec of the screen's m-section", () => {
    const out = section(withStartBitrate(sdp, screen, 5_400_000), "1");
    expect(out).toContain("a=fmtp:98 profile-id=0;x-google-start-bitrate=5400\r\n");
    expect(out).toContain(
      "a=fmtp:100 level-idx=5;profile=0;tier=0;x-google-start-bitrate=5400\r\n",
    );
    expect(out).toContain(
      "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=5400\r\n",
    );
  });

  it("gives a codec without an fmtp line one, so VP8 carries the hint too", () => {
    expect(section(withStartBitrate(sdp, screen, 2_700_000), "1")).toContain(
      "a=rtpmap:96 VP8/90000\r\na=fmtp:96 x-google-start-bitrate=2700\r\na=rtcp-fb:96 goog-remb\r\n",
    );
  });

  it("leaves retransmission and redundancy formats alone", () => {
    const out = section(withStartBitrate(sdp, screen, 5_400_000), "1");
    for (const pt of [97, 99, 101, 103]) {
      expect(out).toContain(`a=fmtp:${pt} apt=${pt === 97 ? 96 : pt - 1}\r\n`);
    }
    expect(out).not.toContain("a=fmtp:104");
    expect(out).not.toContain("a=fmtp:105");
    expect(out.match(/x-google-start-bitrate/g)).toHaveLength(4);
  });

  it("changes nothing outside the screen's m-section", () => {
    const out = withStartBitrate(sdp, screen, 5_400_000);
    expect(section(out, "0")).toBe(section(sdp, "0"));
    expect(section(out, "2")).toBe(section(sdp, "2"));
    expect(out.split("\r\n")[0]).toBe("v=0");
  });

  it("seeds again with a new value, never twice, and keeps every other parameter", () => {
    const once = withStartBitrate(sdp, screen, 5_400_000);
    const again = withStartBitrate(once, screen, 2_700_000);
    const out = section(again, "1");
    expect(out.match(/x-google-start-bitrate/g)).toHaveLength(4);
    expect(out).not.toContain("5400");
    expect(out).toContain(
      "a=fmtp:100 level-idx=5;profile=0;tier=0;x-google-start-bitrate=2700\r\n",
    );
    expect(out).toContain("a=fmtp:96 x-google-start-bitrate=2700\r\n");
    // The same value again is the same text.
    expect(withStartBitrate(once, screen, 5_400_000)).toBe(once);
    // A description that came with its own hint (a peer's) has it replaced, not doubled.
    const theirs = sdp.replace(
      "a=fmtp:98 profile-id=0",
      "a=fmtp:98 x-google-start-bitrate=800;profile-id=0",
    );
    expect(section(withStartBitrate(theirs, screen, 5_400_000), "1")).toContain(
      "a=fmtp:98 profile-id=0;x-google-start-bitrate=5400\r\n",
    );
  });

  it("does nothing without a screen m-section or a positive value, and ignores non-video ones", () => {
    expect(withStartBitrate(sdp, new Set(), 5_400_000)).toBe(sdp);
    expect(withStartBitrate(sdp, new Set(["9"]), 5_400_000)).toBe(sdp);
    expect(withStartBitrate(sdp, screen, 0)).toBe(sdp);
    expect(withStartBitrate(sdp, screen, Number.NaN)).toBe(sdp);
    // Opus in an audio m-section is not a video codec, whatever mid was asked for.
    expect(withStartBitrate(sdp, new Set(["0"]), 5_400_000)).toBe(sdp);
  });

  it("rounds down to whole kbps", () => {
    expect(section(withStartBitrate(sdp, screen, 2_700_900), "1")).toContain(
      "x-google-start-bitrate=2700\r\n",
    );
  });
});

describe("Mesh: the seeded estimate and a share's first minute (ADR 2 addendum)", () => {
  const MBPS = 1_000_000;
  const START_AT = 1_000_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The video section of a description, the way Chromium writes it: VP8 has no fmtp line. The
   * codec the other side lists first is the one the sender sends: VP8 and VP9 are offered, VP9
   * first, unless `first` is H264, which this offers alone with its retransmission format.
   */
  const chromium = (mid: string, first: "VP9" | "H264" = "VP9") =>
    first === "H264"
      ? [
          "v=0",
          "o=- 1 2 IN IP4 127.0.0.1",
          "m=video 9 UDP/TLS/RTP/SAVPF 97 99",
          `a=mid:${mid}`,
          "a=rtpmap:97 rtx/90000",
          "a=fmtp:97 apt=99",
          "a=rtpmap:99 H264/90000",
          "a=fmtp:99 profile-level-id=42e01f",
          "",
        ].join("\r\n")
      : [
          "v=0",
          "o=- 1 2 IN IP4 127.0.0.1",
          "m=video 9 UDP/TLS/RTP/SAVPF 98 96 97",
          `a=mid:${mid}`,
          "a=rtpmap:96 VP8/90000",
          "a=rtpmap:97 rtx/90000",
          "a=fmtp:97 apt=96",
          "a=rtpmap:98 VP9/90000",
          "a=fmtp:98 profile-id=0",
          "",
        ].join("\r\n");

  /**
   * Ana shares `capture` to `names`, with `uplink` to spend. The fake browser writes no video
   * m-sections, so the answers that reach ana are rewritten to carry one for her screen, and
   * her connections record what they were given (`remoteSdps`). Ana's connections are in the
   * order of `names`. The clock is fake (the date only) so that the minute can pass. Ana is
   * `polite` (she answers first, and sends in her own offer) or not (she offers first, with her
   * screen in it, when it is on already): the user ids decide.
   */
  async function share(
    names: string[],
    uplink?: number,
    capture: MediaTrackSettings = { width: 1920, height: 1080, frameRate: 60 },
    {
      firstMinuteMs = FIRST_MINUTE_MS,
      mic = false,
      early = true,
      polite = false,
      withCam = false,
      first = "VP9" as "VP9" | "H264",
      startOrder = undefined as StartOrder | undefined,
    } = {},
  ) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START_AT);
    const network = new Map<string, Mesh>();
    // A side is polite to those with a greater id.
    const self = polite ? "ana" : "zoe";
    const ana = page(self, network, undefined, undefined, uplink, { firstMinuteMs });
    const viewers = names.map((name) => page(name, network));
    const screen = trackWith("ana screen", capture, "text");
    const cam = trackWith("ana cam", { width: 640, height: 360, frameRate: 15 });
    const receive = ana.mesh.receive.bind(ana.mesh);
    ana.mesh.receive = (from, payload) => {
      // Her screen sender, whichever capture it carries now.
      const transceiver = ana.pcs[names.indexOf(from)]?.transceivers.find((t) =>
        /^ana (screen|window)/.test((t.sender.track as MediaStreamTrack | null)?.id ?? ""),
      );
      const mid = transceiver?.mid;
      const answer = payload.kind === "description" && payload.description.type === "answer";
      if (!answer || !transceiver || !mid) return receive(from, payload);
      // Once negotiated, the sender reports the codecs it was given, the one it sends first.
      transceiver.sender.codecs = [{ mimeType: `video/${first}` }, { mimeType: "video/rtx" }];
      receive(from, { ...payload, description: { type: "answer", sdp: chromium(mid, first) } });
    };
    const room = [{ userId: self }, ...names.map((userId) => ({ userId }))];
    if (startOrder) ana.mesh.setStartOrder("screen", startOrder);
    if (mic) ana.mesh.setLocalTracks({ mic: track("ana mic") });
    // `early`: the share is already on when the viewers arrive; otherwise it starts on live pairs.
    const tracks = withCam ? { screen, cam } : { screen };
    if (early) ana.mesh.setLocalTracks(tracks);
    for (const mesh of network.values()) mesh.join(room);
    await settle();
    if (!early) ana.mesh.setLocalTracks(tracks);
    await settle();
    connect(ana, ...viewers);
    await settle();
    const senders = ana.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    return { ana, viewers, network, screen, cam, senders, self };
  }

  /** The start bitrates (kbps) in every remote description each of `ana`'s connections applied. */
  const seeds = (ana: { pcs: FakePC[] }) =>
    ana.pcs.map((pc) =>
      pc.remoteSdps.flatMap((sdp) =>
        [...sdp.matchAll(/x-google-start-bitrate=(\d+)/g)].map((m) => Number(m[1])),
      ),
    );
  /** The first remote description each of `ana`'s connections applied, with its video section. */
  const firstSdp = (ana: { pcs: FakePC[] }, i = 0) =>
    ana.pcs[i]?.remoteSdps.find((sdp) => sdp.includes("m=video")) ?? "";

  describe("the seed", () => {
    it("is written with a start order given first, in the one negotiation the screen is in", async () => {
      // A Mesh made again during a share is given the share's order and its tracks before it joins
      // the room (room-media), so the first offer has the screen in it, as without an order.
      for (const startOrder of [FIREFOX_START, HARDWARE_VP9_START]) {
        const { ana } = await share(["bo"], undefined, undefined, { startOrder });
        expect(seeds(ana)).toEqual([[5400, 5400]]);
        ana.mesh.close();
      }
    });

    it("is 90% of the start step's bitrate, on every video codec of the screen the sender applies", async () => {
      const { ana, viewers } = await share(["bo", "cy"], 8 * MBPS);
      // Each viewer is entitled to 4 Mbps and starts at 1080p30 (3 Mbps): 2700 kbps, on VP8 (a
      // new fmtp line) and on VP9, not on the retransmission format.
      expect(seeds(ana)).toEqual([
        [2700, 2700],
        [2700, 2700],
      ]);
      expect(firstSdp(ana)).toContain("a=fmtp:98 profile-id=0;x-google-start-bitrate=2700\r\n");
      expect(firstSdp(ana)).toContain("a=fmtp:97 apt=96\r\n");
      // A side that sends no screen asks for nothing.
      for (const viewer of viewers) {
        expect(viewer.pcs.flatMap((pc) => pc.remoteSdps).join("")).not.toContain("x-google");
      }
      ana.mesh.close();
    });

    it("follows the step the pair starts on: 1080p60, 1080p30, and 2968x1242 at 60 fps", async () => {
      const full = await share(["bo"]);
      expect(full.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["1080p60"]);
      expect(seeds(full.ana)).toEqual([[5400, 5400]]);
      full.ana.mesh.close();

      const half = await share(["bo", "cy"], 8 * MBPS);
      expect(half.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["1080p30", "1080p30"]);
      expect(seeds(half.ana)[0]).toEqual([2700, 2700]);
      half.ana.mesh.close();

      const wide = await share(["bo"], undefined, { width: 3440, height: 1440, frameRate: 60 });
      expect(wide.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["2968×1242@60"]);
      expect(seeds(wide.ana)).toEqual([[9603, 9603]]);
      wide.ana.mesh.close();
    });

    it("is 90% of the scaled cap when the codec it is negotiated to send is H.264", async () => {
      // One viewer is entitled to all 8 Mbps. On VP9 it starts at 1080p60 (6 Mbps, seed 5400).
      // On H.264 that step is 9 Mbps, over the 8: it starts at 1080p30, 3 x 1.5 = 4.5 Mbps, and
      // seeds at 90% of that.
      const vp9 = await share(["bo"], 8 * MBPS);
      expect(vp9.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["1080p60"]);
      expect(seeds(vp9.ana)).toEqual([[5400, 5400]]);
      vp9.ana.mesh.close();

      const h264 = await share(["bo"], 8 * MBPS, undefined, { first: "H264" });
      expect(h264.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["1080p30"]);
      expect(seeds(h264.ana)).toEqual([[4050]]);
      expect(firstSdp(h264.ana)).toContain(
        "a=fmtp:99 profile-level-id=42e01f;x-google-start-bitrate=4050",
      );
      // The step it started on is the one its encoding is capped for, on the scaled cap.
      expect(h264.senders[0]?.sender.getParameters().encodings?.[0]).toMatchObject({
        maxBitrate: 4.5 * MBPS,
        maxFramerate: 30,
      });
      h264.ana.mesh.close();
    });

    it("is still never above the pair's ceiling on H.264", async () => {
      // 4 Mbps for one viewer: 1080p30 on H.264 (4.5) is too much, 900p30 (2.08 x 1.5 = 3.12)
      // starts, and 90% of that is under the ceiling. At 2.5 Mbps only 720p30 (2) is left, whose
      // 90% (1.8) is.
      const four = await share(["bo"], 4 * MBPS, undefined, { first: "H264" });
      expect(four.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["900p30"]);
      expect(seeds(four.ana)).toEqual([[2808]]);
      four.ana.mesh.close();
      // A budget under the lowest step's scaled cap: the ceiling is what the seed is held to.
      const tight = await share(["bo"], 1 * MBPS, undefined, { first: "H264" });
      expect(tight.ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["720p30"]);
      expect(seeds(tight.ana)).toEqual([[1000]]);
      tight.ana.mesh.close();
    });

    it("never passes the pair's ceiling", async () => {
      // A budget of 1 Mbps for one viewer: the lowest step (720p30, 1.33 Mbps) is the start, and
      // 90% of it (1197 kbps) is over the ceiling, which is what the seed is held to.
      const { ana } = await share(["bo"], 1 * MBPS);
      expect(ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["720p30"]);
      expect(seeds(ana)).toEqual([[1000, 1000]]);
      ana.mesh.close();
    });

    it("is set once: not again when the connection is renegotiated or the share replaced", async () => {
      const { ana } = await share(["bo"]);
      expect(seeds(ana)).toEqual([[5400, 5400]]);
      const descriptions = ana.pcs[0]?.remoteSdps.length ?? 0;
      // A different value in a later description would reset the running estimate in Chromium,
      // and none is needed: it keeps the one it has. Neither a renegotiation...
      ana.pcs[0]?.restartIce();
      await settle();
      expect(ana.pcs[0]?.remoteSdps.length).toBeGreaterThan(descriptions);
      expect(seeds(ana)).toEqual([[5400, 5400]]);
      // ...nor a smaller window with a start step of its own (720p30) asks for another.
      ana.mesh.setLocalTracks({
        screen: trackWith("ana window", { width: 1280, height: 720, frameRate: 30 }, "text"),
      });
      await settle();
      ana.pcs[0]?.restartIce();
      await settle();
      expect(seeds(ana)).toEqual([[5400, 5400]]);
      ana.mesh.close();
    });

    it("is set for a new viewer of a share, whose first negotiation carries the mic and the screen", async () => {
      const { ana } = await share(["bo"], undefined, undefined, { mic: true });
      expect(seeds(ana)).toEqual([[5400, 5400]]);
      ana.mesh.close();
    });

    it("is not set for a share added to a pair that is up: it would reset a running estimate", async () => {
      // Measured in Chromium 153: the estimate of a live connection, reset to a seed, often falls
      // to 300 kbps and then takes tens of seconds to climb, where it would reach the bitrate in
      // under a second without. The mic playing or not makes no difference.
      for (const mic of [false, true]) {
        const { ana } = await share(["bo"], undefined, undefined, { mic, early: false });
        expect(ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["1080p60"]);
        expect(seeds(ana)).toEqual([[]]);
        ana.mesh.close();
      }
    });

    it("is not set when the streamer is the polite side: its screen comes after the first answer", async () => {
      // It answers the viewer's offer first and offers its own senders next; seeded then it
      // collapsed as often as not in Chromium 153, where in the first negotiation it never did.
      const { ana } = await share(["bo"], undefined, undefined, { polite: true });
      expect(ana.mesh.quality().map((q) => q.screen?.rung)).toEqual(["1080p60"]);
      expect(seeds(ana)).toEqual([[]]);
      ana.mesh.close();
    });
  });

  describe("the first minute", () => {
    /** Lossy for `passes` passes: how many it took for bo's pair to step down, or undefined. */
    async function passesToStepDown(ana: Mesh, to: FakeTransceiver, loss = 0.1, limit = 6) {
      to.sender.stats = senderStats(loss);
      for (let i = 1; i <= limit; i++) {
        await ana.adjust();
        await settle();
        if (ana.quality()[0]?.screen?.rung !== "1080p60") return i;
      }
      return undefined;
    }

    it("ignores 1 warm-up reading instead of 2, so pressure steps a new share down a pass sooner", async () => {
      const { ana, senders } = await share(["bo"]);
      expect(await passesToStepDown(ana.mesh, senders[0] as FakeTransceiver)).toBe(3);
      ana.mesh.close();
    });

    it("probes up after 2 clean samples instead of 5, and then waits as usual", async () => {
      const { ana, senders } = await share(["bo"]);
      const to = senders[0] as FakeTransceiver;
      await passesToStepDown(ana.mesh, to);
      const rung = () => ana.mesh.quality()[0]?.screen?.rung;
      expect(rung()).toBe("1080p30");
      to.sender.stats = senderStats(0);
      await ana.mesh.adjust();
      await settle();
      expect(rung()).toBe("1080p30");
      await ana.mesh.adjust();
      await settle();
      expect(rung()).toBe("1080p60");
      ana.mesh.close();
    });

    it("goes back to the normal windows at 60 s", async () => {
      const { ana, senders } = await share(["bo"]);
      const to = senders[0] as FakeTransceiver;
      to.sender.stats = senderStats(0.1);
      const rung = () => ana.mesh.quality()[0]?.screen?.rung;
      // The first reading is ignored in the first minute...
      await ana.mesh.adjust();
      // ...and the minute ends: from here the normal pace, which ignores 2 readings in all.
      vi.setSystemTime(START_AT + FIRST_MINUTE_MS);
      await ana.mesh.adjust();
      await ana.mesh.adjust();
      await settle();
      expect(rung()).toBe("1080p60");
      await ana.mesh.adjust();
      await settle();
      expect(rung()).toBe("1080p30");
      // A probe up now takes the full window.
      to.sender.stats = senderStats(0);
      for (let i = 0; i < UP_SAMPLES - 1; i++) await ana.mesh.adjust();
      await settle();
      expect(rung()).toBe("1080p30");
      await ana.mesh.adjust();
      await settle();
      expect(rung()).toBe("1080p60");
      ana.mesh.close();
    });

    it("starts again for a new viewer on a share that is minutes old, and not for the others", async () => {
      const { ana, viewers, network, screen, senders, self } = await share(["bo"]);
      vi.setSystemTime(START_AT + 5 * FIRST_MINUTE_MS);
      const cy = page("cy", network);
      const everybody = [self, "bo", "cy"].map((userId) => ({ userId }));
      for (const mesh of network.values()) mesh.join(everybody);
      await settle();
      connect(ana, ...viewers, cy);
      await settle();
      const toCy = carrying(ana.pcs[1], screen) as FakeTransceiver;
      const rungs = () => ana.mesh.quality().map((q) => q.screen?.rung);
      expect(rungs()).toEqual(["1080p60", "1080p60"]);
      // Both links are lossy. Cy is new, so ignores one reading and steps down on the third
      // pass; bo's share is minutes old and has the normal two, so he is still where he was.
      (senders[0] as FakeTransceiver).sender.stats = senderStats(0.1);
      toCy.sender.stats = senderStats(0.1);
      for (let i = 0; i < 3; i++) await ana.mesh.adjust();
      await settle();
      expect(rungs()).toEqual(["1080p60", "1080p30"]);
      ana.mesh.close();
    });

    it("starts again for a new capture of a share that is minutes old", async () => {
      const { ana, senders } = await share(["bo"]);
      const rung = () => ana.mesh.quality()[0]?.screen?.rung;
      vi.setSystemTime(START_AT + 5 * FIRST_MINUTE_MS);
      // The same share, five minutes in, has the normal two warm-up readings: 2 + 2 passes.
      expect(await passesToStepDown(ana.mesh, senders[0] as FakeTransceiver)).toBe(4);
      // A new capture (a window picked instead, say) is a share of its own, with a minute of its own.
      const next = trackWith("ana screen 2", { width: 1920, height: 1080, frameRate: 60 }, "text");
      ana.mesh.setLocalTracks({ screen: next });
      await settle();
      expect(rung()).toBe("1080p60");
      const to = carrying(ana.pcs[0], next) as FakeTransceiver;
      expect(await passesToStepDown(ana.mesh, to)).toBe(3);
      ana.mesh.close();
    });

    it("leaves a camera at the normal pace inside the minute: 2 warm-up readings, 5 clean samples", async () => {
      // The real first minute, and a camera that starts at 360p15 on a lossy link.
      const { ana, cam } = await share(["bo"], undefined, undefined, { withCam: true });
      const to = carrying(ana.pcs[0], cam) as FakeTransceiver;
      const rung = () => ana.mesh.quality()[0]?.cam?.rung;
      const pass = async () => {
        await ana.mesh.adjust();
        await settle();
      };
      expect(rung()).toBe("360p15");
      to.sender.stats = senderStats(0.1);
      // A screen would step down on the third pass; a camera ignores two readings, and needs
      // two lossy ones after them.
      for (let i = 0; i < 3; i++) await pass();
      expect(rung()).toBe("360p15");
      await pass();
      expect(rung()).toBe("180p15");
      // And a probe up takes the full window of 5, where a screen's takes 2.
      to.sender.stats = senderStats(0);
      for (let i = 0; i < UP_SAMPLES - 1; i++) await pass();
      expect(rung()).toBe("180p15");
      await pass();
      expect(rung()).toBe("360p15");
      ana.mesh.close();
    });

    it("doesn't start again when a hidden screen comes back: it is the same share and viewer", async () => {
      const { ana, viewers, senders, self } = await share(["bo"]);
      vi.setSystemTime(START_AT + 5 * FIRST_MINUTE_MS);
      const bo = viewers[0] as ReturnType<typeof page>;
      bo.mesh.setVisible(self, "screen", false);
      await settle();
      bo.mesh.setVisible(self, "screen", true);
      await settle();
      // Its readings start over (warm-up of 2 again), but the minute doesn't: 2 + 2 passes.
      expect(await passesToStepDown(ana.mesh, senders[0] as FakeTransceiver)).toBe(4);
      ana.mesh.close();
    });
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

describe("Mesh quality modal: the step message and the last minute (ADR 2 addendum)", () => {
  type Quality = Extract<SignalPayload, { kind: "quality" }>;
  const notes = (sent: SignalPayload[]) =>
    sent.filter((payload): payload is Quality => payload.kind === "quality");

  /** What a receiver's `getStats()` shows `seconds` into a stream: 4 Mbps, 1080p30, no loss. */
  const inbound = (seconds: number, extra: Record<string, number> = {}) =>
    new Map<string, unknown>([
      [
        "i",
        {
          id: "i",
          type: "inbound-rtp",
          kind: "video",
          timestamp: seconds * 1_000,
          bytesReceived: seconds * 500_000,
          packetsReceived: seconds * 100,
          packetsLost: 0,
          frameWidth: 1920,
          frameHeight: 1080,
          framesPerSecond: 30,
          freezeCount: 0,
          ...extra,
        },
      ],
    ]);

  /**
   * Ana shares a 1080p60 screen (text room: frame rate goes before size) to `viewers`, all
   * connected, with `uplink` bits per second to spend. Ana's steps: 720p30, 900p30, 1080p30,
   * 1080p60.
   */
  async function room(viewers: string[], uplink?: number) {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, uplink);
    const others = viewers.map((id) => ({ id, ...page(id, network) }));
    const roster = [{ userId: "ana" }, ...viewers.map((userId) => ({ userId }))];
    for (const mesh of network.values()) mesh.join(roster);
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, ...others);
    await settle();
    const to = ana.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    return { ana, others, screen, to, roster };
  }

  /** The receiver of ana's screen on `bo`'s page. */
  const fromAna = (bo: { mesh: Mesh; pcs: FakePC[] }) => {
    const shown = bo.mesh.peers()[0]?.tracks.screen;
    const receiver = bo.pcs[0]?.getReceivers().find((r) => r.track === shown);
    if (!receiver) throw new Error("bo is not receiving ana's screen");
    return receiver;
  };

  it("tells a viewer the step, its cap and why as soon as the pair connects", async () => {
    const { ana, others } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    // One viewer is entitled to the whole budget: the top step, so "best quality".
    expect(notes(ana.sent)).toMatchObject([
      { seq: 1, step: "1080p60", maxBitrate: 6_000_000, reason: "best" },
    ]);
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      side: "viewer",
      userId: "ana",
      note: { step: "1080p60", maxBitrate: 6_000_000, reason: "best" },
    });
    ana.mesh.close();
  });

  it("says the streamer's side is unknown until the first message", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    connect(ana, bo);
    await settle();
    // Connected, but ana shares nothing: nothing to say.
    expect(notes(ana.sent)).toEqual([]);
    expect(bo.mesh.streamQuality("ana")).toMatchObject({ side: "viewer", userId: "ana" });
    expect(bo.mesh.streamQuality("ana")).not.toHaveProperty("note");
    expect(bo.mesh.streamQuality("nobody")).toBeUndefined();
  });

  it("says the upload is shared when the viewer's share of it can't hold the next step", async () => {
    // 8 Mbps between two viewers: 4 each, so 1080p30 (3 Mbps) fits and 1080p60 (6 Mbps) doesn't.
    const { ana, others } = await room(["bo", "cy"], 8_000_000);
    expect(notes(ana.sent)).toMatchObject([
      { step: "1080p30", maxBitrate: 3_000_000, reason: "shared" },
      { step: "1080p30", maxBitrate: 3_000_000, reason: "shared" },
    ]);
    expect(others[0]?.mesh.streamQuality("ana")).toMatchObject({ note: { reason: "shared" } });
    ana.mesh.close();
  });

  it("sends a message when the step changes and the reason with it, and not when nothing did", async () => {
    const { ana, others, to } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const toBo = to[0] as FakeTransceiver;
    toBo.sender.stats = senderStats(0);
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    await settle();
    // Clean passes change nothing: still the one message from the connect.
    expect(notes(ana.sent)).toHaveLength(1);

    // Strain on the pair: after the warm-up and two pressured readings it steps down, and says so.
    toBo.sender.stats = senderStats(0.1);
    for (let i = 0; i < 2; i++) await ana.mesh.adjust();
    await settle();
    const [, change] = notes(ana.sent);
    expect(change).toMatchObject({
      seq: 2,
      step: "1080p30",
      maxBitrate: 3_000_000,
      reason: "connection",
      cause: "connection",
    });
    // The first message has no cause: the pair hadn't changed step yet.
    expect(notes(ana.sent)[0]).not.toHaveProperty("cause");
    const view = bo.mesh.streamQuality("ana") as Extract<QualityView, { side: "viewer" }>;
    expect(view).toMatchObject({
      note: { seq: 2, step: "1080p30", reason: "connection", cause: "connection" },
      changes: [{ to: "1080p60" }, { from: "1080p60", to: "1080p30", cause: "connection" }],
    });
    expect(view.changes[0]).not.toHaveProperty("cause");
    // Still held down there on a clean sample, it keeps saying why.
    toBo.sender.stats = senderStats(0);
    await ana.mesh.adjust();
    await settle();
    expect(notes(ana.sent)).toHaveLength(2);
    ana.mesh.close();
  });

  it("says the computer when the encoder is CPU-limited", async () => {
    const { ana, others, to } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    (to[0] as FakeTransceiver).sender.stats = senderStats(0, "video/VP9", undefined, "cpu");
    // The codec switch first (nothing to move to here); then the step down for the CPU limit.
    for (let i = 0; i < 6; i++) await ana.mesh.adjust();
    await settle();
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      note: { step: "1080p30", reason: "computer", cause: "computer" },
      changes: [{ to: "1080p60" }, { from: "1080p60", to: "1080p30", cause: "computer" }],
    });
    ana.mesh.close();
  });

  it("keeps the cause of a step down under pressure, not the reason now, on the timeline", async () => {
    const { ana, others, to } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const toBo = to[0] as FakeTransceiver;
    // Strain steps it down; a probe back up after a clean window makes it "best" again.
    toBo.sender.stats = senderStats(0.1);
    for (let i = 0; i < 4; i++) await ana.mesh.adjust();
    toBo.sender.stats = senderStats(0);
    for (let i = 0; i < UP_SAMPLES; i++) await ana.mesh.adjust();
    await settle();
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      note: { step: "1080p60", reason: "best", cause: "probe" },
      changes: [
        { to: "1080p60" },
        { from: "1080p60", to: "1080p30", cause: "connection" },
        { from: "1080p30", to: "1080p60", cause: "probe" },
      ],
    });
    ana.mesh.close();
  });

  it("names a capture resize as the cause of the step it moved the share to", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    const bo = page("bo", network);
    for (const mesh of network.values()) mesh.join(everyone);
    await settle();
    const settings = { width: 1920, height: 1080, frameRate: 60 };
    ana.mesh.setLocalTracks({ screen: trackWith("ana screen", settings, "text") });
    await settle();
    connect(ana, bo);
    await settle();
    // The window is resized to 1280x720: the steps are built again, and it moves to 720p60.
    Object.assign(settings, { width: 1280, height: 720 });
    await ana.mesh.adjust();
    await settle();
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      note: { step: "720p60", cause: "capture" },
      changes: [{ to: "1080p60" }, { from: "1080p60", to: "720p60", cause: "capture" }],
    });
    ana.mesh.close();
  });

  it("names the shared upload as the cause when the budget steps a pair down for a late viewer", async () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network, undefined, undefined, 8_000_000);
    const bo = page("bo", network);
    const cy = page("cy", network);
    const duo = [{ userId: "ana" }, { userId: "bo" }];
    const trio = [...duo, { userId: "cy" }];
    for (const mesh of [ana.mesh, bo.mesh]) mesh.join(duo);
    await settle();
    const screen = trackWith("ana screen", { width: 1920, height: 1080, frameRate: 60 }, "text");
    ana.mesh.setLocalTracks({ screen });
    await settle();
    connect(ana, bo);
    await settle();
    // Bo alone has the whole 8 Mbps: 1080p60 (6 Mbps). Cy arrives and is owed 4.
    for (const mesh of [ana.mesh, bo.mesh, cy.mesh]) mesh.join(trio);
    await settle();
    connect(ana, bo, cy);
    await settle();
    const senders = ana.pcs.map((pc) => carrying(pc, screen) as FakeTransceiver);
    for (let i = 0; i < 40; i++) {
      for (const t of senders) t.sender.stats = senderStats(0);
      await ana.mesh.adjust();
    }
    await settle();
    const view = bo.mesh.streamQuality("ana") as Extract<QualityView, { side: "viewer" }>;
    const stepDown = view.changes.find((c) => c.from === "1080p60");
    expect(stepDown).toMatchObject({ cause: "budget" });
    ana.mesh.close();
  });

  it("tells the viewer again after a step message the socket dropped, once it is back", async () => {
    const { ana, others, to } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const toBo = to[0] as FakeTransceiver;
    toBo.sender.stats = senderStats(0);
    for (let i = 0; i < 2; i++) await ana.mesh.adjust();
    ana.socket.up = false;
    toBo.sender.stats = senderStats(0.1);
    for (let i = 0; i < 2; i++) await ana.mesh.adjust();
    await settle();
    // Dropped: the viewer still has the old step.
    expect(notes(ana.sent)).toHaveLength(1);
    expect(bo.mesh.streamQuality("ana")).toMatchObject({ note: { step: "1080p60" } });

    ana.socket.up = true;
    ana.mesh.resend();
    await settle();
    expect(notes(ana.sent)).toHaveLength(2);
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      note: { seq: 2, step: "1080p30", reason: "connection" },
    });
    // Nothing more to send now.
    ana.mesh.resend();
    await settle();
    expect(notes(ana.sent)).toHaveLength(2);
    ana.mesh.close();
  });

  it("tells the viewer the current state again whenever the pair reconnects", async () => {
    const { ana, others } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    expect(notes(ana.sent)).toHaveLength(1);
    const pc = ana.pcs[0] as FakePC;
    pc.setConnectionState("disconnected");
    pc.setConnectionState("connected");
    await settle();
    expect(notes(ana.sent).map((n) => n.seq)).toEqual([1, 2]);
    expect(bo.mesh.streamQuality("ana")).toMatchObject({ note: { seq: 2, step: "1080p60" } });
    ana.mesh.close();
  });

  it("ignores a stale or repeated message", async () => {
    const { ana, others } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const first = notes(ana.sent)[0] as Quality;
    bo.mesh.receive("ana", { ...first, seq: 5, step: "900p30", reason: "shared" });
    expect(bo.mesh.streamQuality("ana")).toMatchObject({ note: { seq: 5, step: "900p30" } });
    // Late (a lower number), and a repeat of the number: neither changes anything.
    bo.mesh.receive("ana", { ...first, seq: 3, step: "720p30", reason: "computer" });
    bo.mesh.receive("ana", { ...first, seq: 5, step: "720p30", reason: "computer" });
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      note: { seq: 5, step: "900p30", reason: "shared" },
    });
    // The timeline holds the steps as they were heard, not the ones refused.
    expect(bo.mesh.streamQuality("ana")).toMatchObject({
      changes: [{ to: "1080p60" }, { from: "1080p60", to: "900p30" }],
    });
    ana.mesh.close();
  });

  it("ignores a message that reaches the viewer after the server said the share ended", async () => {
    const { ana, others, roster } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const first = notes(ana.sent)[0] as Quality;
    bo.mesh.join(roster.map((p) => ({ ...p, media: { cam: false, share: false } })));
    bo.mesh.receive("ana", { ...first, seq: 9, step: "720p30" });
    expect(bo.mesh.streamQuality("ana")).not.toHaveProperty("note");
    ana.mesh.close();
  });

  it("keeps the last minute of what the viewer receives, from the quality passes", async () => {
    const { ana, others } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const receiver = fromAna(bo);
    for (let s = 4; s <= 16; s += 4) {
      receiver.stats = inbound(s);
      await bo.mesh.adjust();
    }
    const view = bo.mesh.streamQuality("ana") as { points: unknown[] };
    // Four readings: the first sets the baseline, so three points. 4 Mbps, 1080p30, and the cap
    // ana told of.
    expect(view.points).toHaveLength(3);
    expect(view.points).toMatchObject([
      { bps: 4_000_000, height: 1080, fps: 30, capBps: 6_000_000 },
      { bps: 4_000_000 },
      { bps: 4_000_000 },
    ]);
    ana.mesh.close();
  });

  it("reads the pair again on request, between passes, so an open modal stays current", async () => {
    const { ana, others } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const receiver = fromAna(bo);
    receiver.stats = inbound(4);
    await bo.mesh.adjust();
    receiver.stats = inbound(5);
    await bo.mesh.refreshQuality("ana");
    receiver.stats = inbound(6, { freezeCount: 2 });
    await bo.mesh.refreshQuality("ana");
    const view = bo.mesh.streamQuality("ana") as { points: { freezes?: number }[] };
    expect(view.points.map((p) => p.freezes)).toEqual([0, 2]);
    ana.mesh.close();
  });

  it("keeps a streamer's last minute of each viewer's pair and of the uplink against the budget", async () => {
    const { ana, to } = await room(["bo", "cy"], 8_000_000);
    let seconds = 0;
    const pass = async () => {
      seconds += 4;
      for (const t of to) {
        t.sender.stats = senderStats(0, "video/VP9", {
          bytesSent: seconds * 250_000,
          timestamp: seconds * 1_000,
        });
      }
      await ana.mesh.adjust();
    };
    for (let i = 0; i < 4; i++) await pass();
    const view = ana.mesh.streamQuality("ana");
    expect(view).toMatchObject({ side: "streamer", budget: 8_000_000 });
    const streamer = view as Extract<typeof view, { side: "streamer" }>;
    expect(streamer.viewers.map((v) => [v.userId, v.note?.step, v.note?.reason])).toEqual([
      ["bo", "1080p30", "shared"],
      ["cy", "1080p30", "shared"],
    ]);
    // Each viewer's pair: 2 Mbps measured against its step's 3 Mbps cap.
    expect(streamer.viewers[0]?.points.at(-1)).toMatchObject({ bps: 2_000_000, capBps: 3_000_000 });
    // The uplink is both pairs together against the budget.
    expect(streamer.uplink.at(-1)).toMatchObject({ bps: 4_000_000, capBps: 8_000_000 });
    // The timeline across all viewers, oldest first, one first step each.
    expect(streamer.changes.map((c) => [c.userId, c.to, c.cause])).toEqual([
      ["bo", "1080p30", undefined],
      ["cy", "1080p30", undefined],
    ]);
    // Measured by nothing yet: the budget is still the starting estimate.
    expect(streamer.budgetMeasured).toBe(false);
    ana.mesh.close();
  });

  it("doesn't count a viewer's reading older than two passes in the upload it graphs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { ana, to } = await room(["bo"], 8_000_000);
      const toBo = to[0] as FakeTransceiver;
      const sent = (seconds: number) =>
        senderStats(0, "video/VP9", {
          bytesSent: seconds * 250_000,
          timestamp: seconds * 1_000,
        });
      const uplink = () =>
        (ana.mesh.streamQuality("ana") as Extract<QualityView, { side: "streamer" }>).uplink.at(-1);
      toBo.sender.stats = sent(0);
      await ana.mesh.refreshQuality("ana");
      vi.setSystemTime(Date.now() + 1_000);
      toBo.sender.stats = sent(1);
      await ana.mesh.refreshQuality("ana");
      expect(uplink()?.bps).toBe(2_000_000);
      // The viewer's reads stop coming (a hung `getStats`, a stopped sender): the same report
      // again makes no new point, and what was last seen long ago isn't what it sends now.
      vi.setSystemTime(Date.now() + 20_000);
      await ana.mesh.refreshQuality("ana");
      expect(uplink()?.bps).toBe(0);
      ana.mesh.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no view of its own share when it isn't sharing", () => {
    const network = new Map<string, Mesh>();
    const ana = page("ana", network);
    expect(ana.mesh.streamQuality("ana")).toBeUndefined();
  });

  it("forgets what was kept of a share when it ends, and of a peer when they leave", async () => {
    const { ana, others, to, roster } = await room(["bo"]);
    const [bo] = others as [(typeof others)[number]];
    const receiver = fromAna(bo);
    receiver.stats = inbound(4);
    await bo.mesh.adjust();
    receiver.stats = inbound(8);
    await bo.mesh.adjust();
    expect((bo.mesh.streamQuality("ana") as { points: unknown[] }).points).toHaveLength(1);

    // The server says ana's share is over: bo's picture of it goes.
    bo.mesh.join(roster.map((p) => ({ ...p, media: { cam: false, share: false } })));
    expect(bo.mesh.streamQuality("ana")).toMatchObject({ points: [], changes: [] });
    expect(bo.mesh.streamQuality("ana")).not.toHaveProperty("note");

    // Ana's own side: her view goes when she stops, and a share begun anew tells bo afresh.
    const toBo = to[0] as FakeTransceiver;
    toBo.sender.stats = senderStats(0, "video/VP9", { bytesSent: 1_000_000, timestamp: 4_000 });
    await ana.mesh.refreshQuality("ana");
    ana.mesh.setLocalTracks({ screen: null });
    expect(ana.mesh.streamQuality("ana")).toBeUndefined();
    const told = notes(ana.sent).length;
    ana.mesh.setLocalTracks({
      screen: trackWith("ana screen 2", { width: 1920, height: 1080, frameRate: 60 }, "text"),
    });
    await settle();
    expect(notes(ana.sent).length).toBeGreaterThan(told);
    expect(notes(ana.sent).at(-1)?.seq).toBe(told + 1);

    // Leaving drops everything about the peer.
    bo.mesh.peerLeft("ana");
    expect(bo.mesh.streamQuality("ana")).toBeUndefined();
    ana.mesh.close();
  });
});
