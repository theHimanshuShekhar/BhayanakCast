import { describe, expect, it } from "vitest";
import { Mesh, type MeshEvent } from "./mesh";
import type { SignalPayload } from "./realtime";

// The Mesh's negotiation (#34) against a fake RTCPeerConnection that keeps the signalling state
// machine (offers, answers, implicit rollback, negotiationneeded) but carries no media. Real
// browsers are covered by e2e/voice.spec.ts.

let nextPc = 0;

class FakeTransceiver {
  mid: string | null = null;
  readonly sender: { track: unknown; replaceTrack: (track: unknown) => Promise<void> };
  constructor(track: unknown) {
    const sender = {
      track,
      replaceTrack: async (next: unknown) => {
        sender.track = next;
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
  onconnectionstatechange: unknown = null;
  readonly transceivers: FakeTransceiver[] = [];
  /** Own transceivers given a mid by the pending local offer (unset again on rollback). */
  #offered: FakeTransceiver[] = [];
  #needed = false;
  #nextMid = 0;
  #version = 0;

  addTransceiver(trackOrKind: unknown) {
    const t = new FakeTransceiver(typeof trackOrKind === "string" ? null : trackOrKind);
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
      this.ontrack?.({ transceiver: t, track: { id: `track ${mid}` } });
    }
    this.signalingState = "have-remote-offer";
  }

  async addIceCandidate() {}
  async getStats() {
    return new Map();
  }
  close() {
    this.signalingState = "closed";
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
function page(userId: string, network: Map<string, Mesh>) {
  const events: MeshEvent[] = [];
  const pcs: FakePC[] = [];
  const mesh = new Mesh({
    selfId: userId,
    send: (to: string, payload: SignalPayload) =>
      setTimeout(() => network.get(to)?.receive(userId, payload)),
    RTCPeerConnection: class extends FakePC {
      constructor() {
        super();
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

const track = (name: string) => ({ id: name }) as unknown as MediaStreamTrack;
const everyone = [{ userId: "ana" }, { userId: "bo" }];

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
