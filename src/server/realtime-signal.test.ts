import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClientMessage,
  MAX_CLIENT_MESSAGE_BYTES,
  SIGNAL_RATE_LIMIT,
  type SignalPayload,
} from "../lib/realtime.ts";
import {
  type RealtimeHarness,
  startRealtimeHarness,
  type TestClient,
  type TestUser,
} from "./realtime-harness.ts";

// WebRTC signalling relay (#34, ADR 1): only between current members of the same room.

let h: RealtimeHarness;
let ana: TestUser;
let bo: TestUser;
let cy: TestUser;
let roomId: string;

beforeEach(async () => {
  h = await startRealtimeHarness();
  ana = await h.createUser("ana");
  bo = await h.createUser("bo");
  cy = await h.createUser("cy");
  roomId = await h.createRoom(ana, { name: "ana's room" });
});

afterEach(async () => {
  await h.close();
});

/** Each user connected and in `room`, in order; each has seen everyone after them arrive. */
async function inRoom<const U extends TestUser[]>(
  users: U,
  room = roomId,
): Promise<{ [K in keyof U]: TestClient }> {
  const clients: TestClient[] = [];
  for (const user of users) {
    const client = await h.connectAs(user);
    await client.join(room);
    for (const earlier of clients) await earlier.waitForEvent("joined");
    clients.push(client);
  }
  return clients as { [K in keyof U]: TestClient };
}

const OFFER: SignalPayload = {
  kind: "description",
  session: "pc-1",
  description: { type: "offer", sdp: "v=0\r\n" },
  slots: { "0": "mic" },
};
const CANDIDATE: SignalPayload = {
  kind: "candidate",
  session: "pc-1",
  peerSession: "pc-9",
  candidate: { candidate: "candidate:1 1 udp 1 127.0.0.1 5000 typ host", sdpMid: "0" },
};
const HELLO: SignalPayload = { kind: "hello", session: "pc-2" };
const HIDDEN: SignalPayload = {
  kind: "visibility",
  session: "pc-2",
  peerSession: "pc-1",
  slot: "cam",
  visible: false,
};

const signal = (to: TestUser, payload: SignalPayload = OFFER): ClientMessage => ({
  type: "signal",
  to: to.id,
  payload,
});

/** Send `message` from `client` and return the refusal it gets. */
async function refused(client: TestClient, message: ClientMessage) {
  client.send(message);
  return client.waitFor("error", (e) => e.re === message.type);
}

describe("signal", () => {
  it("relays the payload untouched to the addressee only, stamped with the sender", async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    a.send(signal(bo, OFFER));
    a.send(signal(bo, CANDIDATE));
    expect(await b.waitFor("signal")).toEqual({
      type: "signal",
      roomId,
      from: ana.id,
      payload: OFFER,
    });
    expect(await b.waitFor("signal")).toEqual({
      type: "signal",
      roomId,
      from: ana.id,
      payload: CANDIDATE,
    });

    b.send(signal(ana, HELLO));
    expect(await a.waitFor("signal")).toEqual({
      type: "signal",
      roomId,
      from: bo.id,
      payload: HELLO,
    });

    // A viewer no longer showing ana's camera tells her (#35): she pauses it towards them.
    b.send(signal(ana, HIDDEN));
    expect(await a.waitFor("signal")).toEqual({
      type: "signal",
      roomId,
      from: bo.id,
      payload: HIDDEN,
    });

    await h.settled();
    for (const client of [a, b, c]) expect(client.pending()).toEqual([]);
  });

  it("is refused from someone who isn't in a room", async () => {
    await inRoom([ana]);
    const outsider = await h.connectAs(bo);
    expect(await refused(outsider, signal(ana))).toMatchObject({ code: "forbidden" });
  });

  it("is refused across rooms, to someone in no room, and to the sender", async () => {
    const otherRoom = await h.createRoom(cy, { name: "cy's room" });
    const [a] = await inRoom([ana]);
    const [c] = await inRoom([cy], otherRoom);
    const outsider = await h.connectAs(bo);

    for (const to of [cy, bo, ana]) {
      expect(await refused(a, signal(to))).toMatchObject({ code: "not_found" });
    }
    expect(await refused(c, signal(ana))).toMatchObject({ code: "not_found" });
    await h.settled();
    expect(outsider.pending()).toEqual([]);
    expect(c.pending()).toEqual([]);
    expect(a.pending()).toEqual([]);
  });

  it("stops once either side leaves", async () => {
    const [a, b] = await inRoom([ana, bo]);
    b.send({ type: "room.leave" });
    await a.waitForEvent("left");
    expect(await refused(a, signal(bo))).toMatchObject({ code: "not_found" });
    expect(await refused(b, signal(ana))).toMatchObject({ code: "forbidden" });
    await h.settled();
    expect(b.pending()).toEqual([]);
  });

  it("is refused to and from a kicked user", async () => {
    const [a, b] = await inRoom([ana, bo]);
    a.send({ type: "mod.kick", userId: bo.id });
    await b.waitFor("error", (e) => e.code === "kicked");
    await a.waitForEvent("kicked");
    expect(await refused(b, signal(ana))).toMatchObject({ code: "forbidden" });
    expect(await refused(a, signal(bo))).toMatchObject({ code: "not_found" });
  });

  it("is refused from a connection that was taken over, and goes to the new one", async () => {
    const [a, oldTab] = await inRoom([ana, bo]);
    const newTab = await h.connectAs(bo);
    await newTab.join(roomId);
    await oldTab.waitFor("error", (e) => e.code === "taken_over");
    expect(await refused(oldTab, signal(ana))).toMatchObject({ code: "forbidden" });

    newTab.send(signal(ana));
    expect((await a.waitFor("signal")).from).toBe(bo.id);
    a.send(signal(bo, HELLO));
    expect((await newTab.waitFor("signal")).payload).toEqual(HELLO);
    await h.settled();
    expect(oldTab.pending()).toEqual([]);
  });

  it("is dropped for someone in their reconnect grace", async () => {
    const [a, b] = await inRoom([ana, bo]);
    await b.close();
    await h.settled();
    a.send(signal(bo));
    await h.settled();
    expect(a.pending()).toEqual([]);
  });

  it("is refused from a visitor", async () => {
    await inRoom([ana]);
    const visitor = await h.connect(null);
    visitor.send({ type: "hello", v: 1 });
    await visitor.waitFor("welcome");
    expect(await refused(visitor, signal(ana))).toMatchObject({ code: "forbidden" });
  });

  it(`allows a join's burst but limits each user to ${SIGNAL_RATE_LIMIT.messages} in any ${SIGNAL_RATE_LIMIT.windowMs / 1_000} seconds`, async () => {
    const [a, b, c] = await inRoom([ana, bo, cy]);
    const relayed = () =>
      [b, c].flatMap((client) => client.received.filter((m) => m.type === "signal")).length;

    // Entering a full room: an offer and ~20 candidates to each of 9 peers, all at once.
    for (let peer = 0; peer < 9; peer++) {
      const to = peer % 2 ? cy : bo;
      a.send(signal(to, OFFER));
      for (let i = 0; i < 20; i++) a.send(signal(to, CANDIDATE));
    }
    await expect.poll(relayed).toBe(9 * 21);
    await h.settled();
    expect(a.pending()).toEqual([]);

    // A flood past the limit is refused; others have their own allowance.
    for (let i = 9 * 21; i < SIGNAL_RATE_LIMIT.messages; i++) a.send(signal(bo, CANDIDATE));
    expect(await refused(a, signal(bo, CANDIDATE))).toMatchObject({ code: "rate_limited" });
    b.send(signal(ana, HELLO));
    expect((await a.waitFor("signal")).from).toBe(bo.id);
    await expect.poll(relayed).toBe(SIGNAL_RATE_LIMIT.messages);

    // Once the window has passed, signalling flows again.
    await h.advance(SIGNAL_RATE_LIMIT.windowMs);
    a.send(signal(bo, CANDIDATE));
    await expect.poll(relayed).toBe(SIGNAL_RATE_LIMIT.messages + 1);
    await h.settled();
    expect(a.pending()).toEqual([]);
  });

  it("relays an offer with all four slots both ways, and closes a socket sending more than the cap", async () => {
    const [a, b] = await inRoom([ana, bo]);
    // Chromium's offer for eight m-sections is about 24 KB (ADR 4 addendum).
    const offer: SignalPayload = {
      ...OFFER,
      description: { type: "offer", sdp: `v=0\r\n${"a=x\r\n".repeat(6_000)}` },
    };
    a.send(signal(bo, offer));
    expect((await b.waitFor("signal")).payload).toEqual(offer);

    a.sendRaw("x".repeat(MAX_CLIENT_MESSAGE_BYTES + 1));
    expect(await a.closed()).toBe(1009);
  });

  it("relays the video codecs each side can decode with its hello and descriptions", async () => {
    const [a, b] = await inRoom([ana, bo]);
    const codecs = ["video/AV1", "video/VP9", "video/H264", "video/VP8"];
    a.send(signal(bo, { ...HELLO, codecs }));
    expect((await b.waitFor("signal")).payload).toEqual({ ...HELLO, codecs });
    a.send(signal(bo, { ...OFFER, codecs }));
    expect((await b.waitFor("signal")).payload).toEqual({ ...OFFER, codecs });
  });

  it("refuses a malformed payload", async () => {
    const [a] = await inRoom([ana, bo]);
    a.sendRaw(
      JSON.stringify({
        type: "signal",
        to: bo.id,
        payload: { ...HELLO, codecs: ["x".repeat(49)] },
      }),
    );
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "signal" });
    a.sendRaw(JSON.stringify({ type: "signal", to: bo.id, payload: { kind: "nonsense" } }));
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "signal" });
    a.sendRaw(
      JSON.stringify({ type: "signal", to: bo.id, payload: { ...HIDDEN, slot: "everything" } }),
    );
    expect(await a.waitFor("error")).toMatchObject({ code: "bad_request", re: "signal" });
  });
});
